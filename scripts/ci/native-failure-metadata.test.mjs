import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./windows-standard-token/NativeFailureMetadata.cs',import.meta.url),'utf8');
const program=readFileSync(new URL('./windows-standard-token/Program.cs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');

// These dependency-free checks guard the execution/permission contract on the
// Linux route job. They do not compile C# or execute the Windows-only selftest.
test('the original complete Windows command and failure propagation remain unchanged',()=>{
  const step=workflow.split('- name: Run the complete original Windows check\n')[1].split('      - name:')[0];
  assert.equal(step,`        working-directory: \${{ steps.restore.outputs.directory || github.workspace }}
        if: matrix.kind == 'windows'
        shell: pwsh
        run: |
          if ([string]::IsNullOrWhiteSpace($env:PA_CI_CHECK_LAUNCHER) -or
              -not (Test-Path -LiteralPath $env:PA_CI_CHECK_LAUNCHER -PathType Leaf)) {
            throw 'The actual standard-token smoke must pass before the complete check.'
          }
          & $env:PA_CI_CHECK_LAUNCHER --run-check
          exit $LASTEXITCODE
`);
  const check=program.slice(program.indexOf('string cmd = CanonicalFile'),program.indexOf('\n        catch (Exception error)'));
  assert.match(check,/string command = Quote\(cmd\) \+ " \/d \/s \/c/u);
  assert.match(check,/npm \+ "\\" run check/u);
  const pin=check.indexOf('ReadPinnedNodeVersion'),start=check.indexOf('using (var child = Start('),wait=check.indexOf('exit = child.Wait();');
  assert.ok(pin>=0&&pin<start&&start<wait);
  assert.ok(check.indexOf('NativeFailureMetadata.AfterCheck(')>wait);
  assert.ok(check.indexOf('} // Close the original Job')>wait);
  assert.ok(check.indexOf('} // Close the original Job')<check.indexOf('NativeFailureMetadata.AfterCheck('));
  assert.match(check,/catch \{ \/\* Diagnostics, including type initialization, cannot replace the original exit\. \*\/ \}/u);
  assert.match(check,/return unchecked\(\(int\)exit\);/u);
  assert.match(source,/internal static uint PreserveExit\(uint originalExit, Action diagnostics\)/u);
  assert.match(source,/try \{ diagnostics\(\); \} catch[^\n]+\n\s+return originalExit;/u);
});

test('post-check metadata executes only inside the loaded launcher with System32-only native imports',()=>{
  assert.doesNotMatch(source,/Process\.Start|CreateProcess|Assembly\.Load|GetEnvironmentVariable|SetToken|SetInformationJob|SetSecurity|WriteAll|AppendAll/u);
  const declarations=[...source.matchAll(/\[DllImport\("wevtapi\.dll"[^\n]+\)\]/gu)];
  assert.equal(declarations.length,4);
  assert.equal((source.match(/DefaultDllImportSearchPaths\(DllImportSearchPath\.System32\)/gu)||[]).length,4);
  for(const declaration of declarations) {
    assert.match(declaration[0],/ExactSpelling = true/u);
    const preceding=source.slice(Math.max(0,declaration.index-100),declaration.index);
    assert.match(preceding,/DefaultDllImportSearchPaths\(DllImportSearchPath\.System32\)\]\s*$/u);
  }
  assert.equal((source.match(/File\.ReadAllText/gu)||[]).length,1);
  assert.match(source,/file\.Length > 32 \|\| \(file\.Attributes & FileAttributes\.ReparsePoint\) != 0/u);
  assert.doesNotMatch(workflow,/post-check.*\.ps1|windows-native-diagnostics\.(?:mjs|ps1)/u);
});

test('event queries and XML are bounded and handles use their matching release functions',()=>{
  assert.match(source,/MaxXmlBytes = 65536, MaxEvents = 128, MaxCandidates = 16/u);
  assert.match(source,/Provider\[@Name='Application Error'\].*EventID=1000/u);
  assert.match(source,/EvtQuery\(IntPtr.Zero, "Application", query, 0x201\)/u);
  assert.match(source,/while \(inspected < MaxEvents && candidates\.Count < MaxCandidates\)/u);
  assert.match(source,/read\.Wait\(TimeSpan\.FromSeconds\(6\)\)/u);
  assert.match(source,/EvtNext\(results.Value, 1, events, 1000, 0/u);
  assert.match(source,/DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null/u);
  assert.match(source,/MaxCharactersInDocument = MaxXmlBytes \/ 2, MaxCharactersFromEntities = 1024/u);
  assert.match(source,/finally \{ Marshal.FreeHGlobal\(memory\); \}/u);
  assert.match(source,/finally \{ if \(events\[0\] != IntPtr.Zero\) EvtClose\(events\[0\]\); \}/u);
  assert.match(source,/using var results = new EventHandle/u);
  assert.match(source,/Render\(events\[0\], out bool readable\)/u);
  assert.match(source,/if \(!readable\) return Unavailable\("render_unavailable"\)/u);
  assert.doesNotMatch(source,/CloseHandle|FreeLibrary/u);
  assert.doesNotMatch(source,/@"[^"\r\n]*\$"/u,'Use absolute .NET regex anchors; $ permits a trailing newline');
});

test('healthy checks exercise actual XML filtering and read access without claiming native crash validation',()=>{
  assert.match(source,/bool verified = SelfTest\(\);/u);
  assert.match(source,/ReadWithBudget\(start, end, pin, originalExit != 0\)/u);
  assert.match(source,/originalExit == 0 \? "read_only_probe" : "failure_candidates"/u);
  assert.match(source,/check_time_window_candidates_without_test_process_correlation/u);
  assert.match(source,/"no_matching_candidates"/u);
  assert.match(program,/if \(!NativeFailureMetadata.VerifyForSmoke\([^\n]+\)\) return 125;/u);
  assert.match(source,/mode = "smoke_validation"/u);
  assert.match(source,/probeStatus = probe.Status, probeReason = probe.Reason/u);
  const selftest=source.slice(source.indexOf('internal static bool SelfTest()'),source.indexOf('sealed class EventHandle'));
  for(const behavior of ['PreserveExit(exit','3221226505','JsonSerializer.Serialize(good).Contains(secret','C:/private/','24.15.1.0',
    'duplicate.dll','<EventID>1001','9007199254740992','<!DOCTYPE Event','MaxXmlBytes / 2 + 1',
    'ucrtbase.dll\\n','C0000409\\n','00001234ABCD\\n','badOptionalVersion.ModuleVersion != null'])assert.ok(selftest.includes(behavior),behavior);
  assert.match(source,/catch \{ return null; \} \/\/ Never return parser errors/u);
  assert.doesNotMatch(source,/\.Message\b|\.StackTrace\b|\.ToXml\(|candidate.*(?:AppPath|ModulePath|User|Computer|Environment)/u);
});

test('the existing fresh SDK publish includes every launcher C# input and checks the real smoke exit',()=>{
  const project=readFileSync(new URL('./windows-standard-token/WindowsStandardTokenLauncher.csproj',import.meta.url),'utf8');
  const smoke=readFileSync(new URL('./windows-standard-token/smoke.ps1',import.meta.url),'utf8');
  assert.match(project,/<Project Sdk="Microsoft.NET.Sdk">/u);
  assert.match(project,/<TargetFramework>net8.0-windows<\/TargetFramework>/u);
  assert.doesNotMatch(project,/EnableDefaultCompileItems|Compile Remove/u);
  assert.match(smoke,/\[Guid\]::NewGuid\(\)/u);
  assert.match(smoke,/dotnet publish \$project .*--output \$target/u);
  assert.match(smoke,/& \$launcher --smoke\r?\nif \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/u);
});
