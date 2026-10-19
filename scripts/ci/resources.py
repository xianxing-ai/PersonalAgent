#!/usr/bin/env python3
"""Resource guard for the dedicated Linux ECS; installed outside the checkout."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path('/opt/personalagent-ci')
RUNNER = ROOT / 'runner'
WORK = RUNNER / '_work'
STATE = ROOT / 'resource-state'
NPM_LOGS = Path('/var/lib/personalagent-ci/.npm/_logs')
GIB = 1024 ** 3
MIN_DISK = 8 * GIB
MIN_MEMORY = 2560 * 1024 ** 2


def expired_owned(entry, cutoff, uid):
    """Never follow source links or delete a tree with recent/foreign entries."""
    stack = [entry]
    while stack:
        item = stack.pop()
        info = item.lstat()
        if item.is_symlink() or info.st_uid != uid or info.st_mtime >= cutoff:
            return False
        if item.is_dir():
            stack.extend(item.iterdir())
    return True


def expire(directory, pattern, age_days, *, dry=False, uid=None):
    if not directory.exists():
        return []
    if directory.is_symlink():
        raise ValueError('CI cleanup root must not be a symbolic link')
    root = directory.resolve(strict=True)
    removed = []
    for entry in root.glob(pattern):
        if entry.parent != root:
            raise ValueError('CI cleanup accepts direct children only')
        if expired_owned(entry, time.time() - age_days * 86400, os.getuid() if uid is None else uid):
            removed.append(str(entry))
            if not dry:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
    return removed


def workers():
    result = []
    for item in Path('/proc').glob('[0-9]*'):
        try:
            if item.stat().st_uid == os.getuid() and (item / 'comm').read_text().strip() == 'Runner.Worker':
                result.append(int(item.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    return result


def metrics():
    mem = {row.split(':')[0]: int(row.split()[1]) * 1024 for row in Path('/proc/meminfo').read_text().splitlines() if row.startswith(('MemTotal:', 'MemAvailable:'))}
    return {'at': int(time.time()), 'memoryTotal': mem['MemTotal'], 'memoryAvailable': mem['MemAvailable'], 'diskFree': shutil.disk_usage(WORK).free}


def report(value):
    text = json.dumps(value, ensure_ascii=False)
    print(text, flush=True)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as target:
            target.write('\nCI resources: `' + text + '`\n')


def cleanup(dry=False):
    removed = []
    for directory, pattern, days in [(WORK / '_temp', '*', 7), (RUNNER / '_diag', 'Worker_*.log', 14), (RUNNER / '_diag', 'Runner_*.log', 30), (NPM_LOGS, '*-debug-*.log', 14), (STATE, 'job-*.jsonl', 14)]:
        removed.extend(expire(directory, pattern, days, dry=dry))
    # Fixed repository cache, never the checkout or arbitrary user data.
    removed.extend(expire(WORK / 'PersonalAgent/PersonalAgent/.cache/agentarts-image', 'context-*', 3, dry=dry))
    report({'cleanup': 'dry-run' if dry else 'expired CI data', 'removed': removed})
    if not dry:
        subprocess.run(['/usr/bin/docker', 'builder', 'prune', '--force', '--filter', 'until=168h', '--keep-storage', '6GB'], check=True, timeout=120)


def sample(worker, destination):
    while worker in workers():
        with destination.open('a', encoding='utf-8') as target:
            target.write(json.dumps(metrics()) + '\n')
        time.sleep(5)


def job_file():
    run = os.environ.get('GITHUB_RUN_ID', 'manual')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    if not run.isdecimal() or not attempt.isdecimal():
        return None
    return STATE / f'job-{run}-{attempt}.jsonl'


def complete():
    source = job_file()
    samples = []
    if source and source.exists():
        for row in source.read_text().splitlines():
            try:
                samples.append(json.loads(row))
            except json.JSONDecodeError:
                pass  # A sampler may currently be appending one final row.
    value = metrics()
    if samples:
        value['minimumMemoryAvailableDuringJob'] = min(row['memoryAvailable'] for row in samples)
        value['minimumDiskFreeDuringJob'] = min(row['diskFree'] for row in samples)
        value['wholeHostPeakUsedMemory'] = max(row['memoryTotal'] - row['memoryAvailable'] for row in samples)
    report({'jobFinished': value})


def main(mode):
    if mode == 'sample':
        sample(int(sys.argv[2]), Path(sys.argv[3]))
        return
    STATE.mkdir(exist_ok=True)
    with (STATE / 'maintenance.lock').open('a') as lock:
        # Job preflight waits for maintenance; idle maintenance never waits for a job.
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if mode in ('maintain', 'dry-run') else 0))
        except BlockingIOError:
            report({'maintenance': 'skipped: another resource operation is active'})
            return
        if mode in ('maintain', 'dry-run'):
            active = workers()
            if active:
                report({'maintenance': 'skipped: CI is active', 'workers': active})
                return
            cleanup(dry=mode == 'dry-run')
        elif mode == 'start':
            if len(workers()) > 1:
                raise RuntimeError('Multiple heavy CI workers on this 2-core node; serialize jobs')
            before = metrics()
            if before['diskFree'] < MIN_DISK:
                cleanup()
            current = metrics()
            report({'preflight': current, 'minimumDiskFree': MIN_DISK, 'minimumMemoryAvailable': MIN_MEMORY})
            if current['diskFree'] < MIN_DISK or current['memoryAvailable'] < MIN_MEMORY:
                raise RuntimeError('CI resources insufficient after bounded cleanup; inspect resource report, retry when idle or explicitly switch PA_IMAGE_RUNNER=github')
            source = job_file()
            active = workers()
            if source and active and not source.exists():
                source.touch()
                subprocess.Popen(['/usr/bin/python3', str(Path(__file__).resolve()), 'sample', str(active[0]), str(source)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env={'PATH': '/usr/bin:/bin'})
        elif mode == 'complete':
            complete()
        else:
            raise ValueError('Unknown resource operation')


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except Exception as error:
        report({'resourceFailure': str(error), 'action': 'Do not merge; inspect the node, retry later or explicitly use the hosted-runner switch. No automatic purchases or task termination.'})
        sys.exit(1)
