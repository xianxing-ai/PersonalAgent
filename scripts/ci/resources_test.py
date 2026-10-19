import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import resources
from resources import expire


class CleanupSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def old(self, path):
        os.utime(path, (time.time() - 30 * 86400,) * 2)
        return path

    def test_dry_run_retains_expired_owned_file(self):
        item = self.root / 'expired.log'
        item.touch()
        self.old(item)
        self.assertEqual(expire(self.root, '*.log', 14, dry=True), [str(item)])
        self.assertTrue(item.exists())

    def test_removes_only_expired_matching_ci_files(self):
        old = self.root / 'Worker_old.log'
        old.touch()
        self.old(old)
        recent = self.root / 'Worker_recent.log'
        recent.touch()
        other = self.root / 'keep.txt'
        other.touch()
        self.old(other)
        self.assertEqual(expire(self.root, 'Worker_*.log', 14), [str(old)])
        self.assertTrue(recent.exists())
        self.assertTrue(other.exists())

    def test_recent_descendant_preserves_old_directory(self):
        folder = self.root / 'context-old'
        folder.mkdir()
        (folder / 'active').touch()
        self.old(folder)
        self.assertEqual(expire(self.root, 'context-*', 3), [])

    def test_does_not_follow_symbolic_link(self):
        outside = self.root / 'user-data'
        outside.mkdir()
        value = outside / 'keep'
        value.touch()
        link = self.root / 'context-link'
        link.symlink_to(outside, target_is_directory=True)
        self.assertEqual(expire(self.root, 'context-*', 0), [])
        self.assertTrue(value.exists())

    def test_rejects_symbolic_cleanup_root(self):
        link = self.root / 'link'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            expire(link, '*.log', 14)

    def test_foreign_ownership_is_not_deleted(self):
        item = self.root / 'expired.log'
        item.touch()
        self.old(item)
        self.assertEqual(expire(self.root, '*.log', 14, uid=os.getuid() + 1), [])

    def test_active_worker_prevents_maintenance(self):
        with patch.object(resources, 'STATE', self.root), patch.object(resources, 'workers', return_value=[123]), patch.object(resources, 'cleanup') as cleanup:
            resources.main('maintain')
            cleanup.assert_not_called()

    def test_insufficient_memory_fails_job_without_deleting_data(self):
        snapshot = {'diskFree': resources.MIN_DISK + 1, 'memoryAvailable': resources.MIN_MEMORY - 1}
        with patch.object(resources, 'STATE', self.root), patch.object(resources, 'workers', return_value=[]), patch.object(resources, 'metrics', return_value=snapshot), patch.object(resources, 'cleanup') as cleanup:
            with self.assertRaisesRegex(RuntimeError, 'insufficient'):
                resources.main('start')
            cleanup.assert_not_called()


if __name__ == '__main__':
    unittest.main()
