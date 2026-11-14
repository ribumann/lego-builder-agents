$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

$nativeSource = @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public sealed class BrickLabJobOutcome
{
    public string Status;
    public string ErrorCode;
    public string FailureStage;
    public int ExitCode;
    public byte[] Stdout;
    public byte[] Stderr;
    public bool CleanupConfirmed;
}

public static class BrickLabJobHost
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint JobLimitActiveProcess = 0x00000008;
    private const uint JobLimitKillOnClose = 0x00002000;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int StartfUseStdHandles = 0x00000100;
    private const int ProcThreadAttributeHandleList = 0x00020002;
    private const uint GenericRead = 0x80000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 0x00000102;
    private const uint Infinite = 0xffffffff;

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string Reserved;
        public string Desktop;
        public string Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountChars;
        public uint YCountChars;
        public uint FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AccountingInformation
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaults;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    private sealed class OutputBudget
    {
        private readonly int _maximum;
        private int _written;
        public readonly ManualResetEvent Overflow = new ManualResetEvent(false);

        public OutputBudget(int maximum) { _maximum = maximum; }

        public int Reserve(int requested)
        {
            int current;
            int allowed;
            do
            {
                current = Interlocked.CompareExchange(ref _written, 0, 0);
                allowed = Math.Max(0, Math.Min(requested, _maximum - current));
            }
            while (Interlocked.CompareExchange(ref _written, current + allowed, current) != current);
            if (allowed != requested) Overflow.Set();
            return allowed;
        }
    }

    private sealed class OutputBuffer
    {
        private readonly OutputBudget _budget;
        private readonly MemoryStream _buffer = new MemoryStream();
        public OutputBuffer(OutputBudget budget) { _budget = budget; }
        public void Read(IntPtr handle)
        {
            using (SafeFileHandle safe = new SafeFileHandle(handle, true))
            using (FileStream stream = new FileStream(safe, FileAccess.Read, 8192, false))
            {
                byte[] chunk = new byte[8192];
                int count;
                while ((count = stream.Read(chunk, 0, chunk.Length)) > 0)
                {
                    int allowed = _budget.Reserve(count);
                    if (allowed > 0) _buffer.Write(chunk, 0, allowed);
                }
            }
        }
        public byte[] ToArray() { return _buffer.ToArray(); }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(ref SecurityAttributes attributes, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateDirectoryW", SetLastError = true)]
    private static extern bool CreateDirectory(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimitInformation information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW", SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out AccountingInformation information, uint length, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);

    public static void CreatePrivateDirectory(string path, byte[] descriptor)
    {
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            SecurityAttributes attributes = new SecurityAttributes();
            attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            attributes.SecurityDescriptor = pinned.AddrOfPinnedObject();
            attributes.InheritHandle = false;
            if (!CreateDirectory(path, ref attributes))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { pinned.Free(); }
    }

    public static BrickLabJobOutcome Run(string executable, string[] arguments, string attachment, string directory, int timeoutMs, int maxOutputBytes, Func<bool> isCancelled)
    {
        BrickLabJobOutcome outcome = new BrickLabJobOutcome();
        outcome.Status = "launcher-failed";
        outcome.ErrorCode = "launcher-failed";
        outcome.ExitCode = -1;
        outcome.Stdout = new byte[0];
        outcome.Stderr = new byte[0];
        outcome.CleanupConfirmed = false;

        IntPtr job = IntPtr.Zero;
        IntPtr nul = IntPtr.Zero;
        IntPtr stdoutRead = IntPtr.Zero;
        IntPtr stdoutWrite = IntPtr.Zero;
        IntPtr stderrRead = IntPtr.Zero;
        IntPtr stderrWrite = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr attributeSize = IntPtr.Zero;
        IntPtr inheritedHandles = IntPtr.Zero;
        ProcessInformation process = new ProcessInformation();
        bool processCreated = false;
        bool assigned = false;
        Task stdoutTask = null;
        Task stderrTask = null;
        OutputBuffer stdoutBuffer = null;
        OutputBuffer stderrBuffer = null;
        OutputBudget budget = new OutputBudget(maxOutputBytes);
        bool safeToDelete = true;
        string stopStatus = null;
        string failureStage = "job-create";

        try
        {
            SecurityAttributes jobAttributes = new SecurityAttributes();
            jobAttributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            jobAttributes.InheritHandle = false;
            job = CreateJobObject(ref jobAttributes, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

            uint jobHandleFlags;
            if (!GetHandleInformation(job, out jobHandleFlags) || (jobHandleFlags & HandleFlagInherit) != 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());

            failureStage = "job-limits";
            ExtendedLimitInformation limits = new ExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = JobLimitKillOnClose | JobLimitActiveProcess;
            limits.BasicLimitInformation.ActiveProcessLimit = 32;
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            SecurityAttributes pipeAttributes = new SecurityAttributes();
            failureStage = "pipes";
            pipeAttributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            pipeAttributes.InheritHandle = true;
            if (!CreatePipe(out stdoutRead, out stdoutWrite, ref pipeAttributes, 0) ||
                !CreatePipe(out stderrRead, out stderrWrite, ref pipeAttributes, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!SetHandleInformation(stdoutRead, HandleFlagInherit, 0) || !SetHandleInformation(stderrRead, HandleFlagInherit, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            nul = CreateFile("NUL", GenericRead, FileShareRead | FileShareWrite, ref pipeAttributes, OpenExisting, FileAttributeNormal, IntPtr.Zero);
            if (nul == IntPtr.Zero || nul == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());

            IntPtr required = IntPtr.Zero;
            failureStage = "handle-list";
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref required);
            if (required == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            attributeList = Marshal.AllocHGlobal(required);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref required))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            inheritedHandles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(inheritedHandles, 0, nul);
            Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size, stdoutWrite);
            Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size * 2, stderrWrite);
            if (!UpdateProcThreadAttribute(attributeList, 0, new IntPtr(ProcThreadAttributeHandleList), inheritedHandles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            List<string> fullArguments = new List<string>(arguments);
            fullArguments.Add("--attachment");
            fullArguments.Add(attachment);
            StringBuilder command = new StringBuilder(QuoteArgument(executable));
            foreach (string argument in fullArguments) command.Append(' ').Append(QuoteArgument(argument));
            if (command.Length > 30000) throw new InvalidOperationException("Command line is too large.");

            StartupInfoEx startup = new StartupInfoEx();
            failureStage = "create-process";
            startup.StartupInfo.Size = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.StartupInfo.Flags = StartfUseStdHandles;
            startup.StartupInfo.StdInput = nul;
            startup.StartupInfo.StdOutput = stdoutWrite;
            startup.StartupInfo.StdError = stderrWrite;
            startup.AttributeList = attributeList;
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true,
                CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent | CreateUnicodeEnvironment,
                IntPtr.Zero, directory, ref startup, out process))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            processCreated = true;

            failureStage = "assign-process";
            if (!AssignProcessToJobObject(job, process.Process))
            {
                TerminateProcess(process.Process, 1);
                WaitForSingleObject(process.Process, 5000);
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            assigned = true;

            stdoutBuffer = new OutputBuffer(budget);
            stderrBuffer = new OutputBuffer(budget);
            IntPtr stdoutReadHandle = stdoutRead;
            stdoutTask = Task.Factory.StartNew(() => stdoutBuffer.Read(stdoutReadHandle), TaskCreationOptions.LongRunning);
            stdoutRead = IntPtr.Zero;
            IntPtr stderrReadHandle = stderrRead;
            stderrTask = Task.Factory.StartNew(() => stderrBuffer.Read(stderrReadHandle), TaskCreationOptions.LongRunning);
            stderrRead = IntPtr.Zero;

            failureStage = "resume-process";
            bool cancelledBeforeResume = false;
            try { cancelledBeforeResume = isCancelled(); } catch { cancelledBeforeResume = true; }
            if (cancelledBeforeResume) stopStatus = "cancelled";
            else if (ResumeThread(process.Thread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
            CloseIfValid(ref stdoutWrite);
            CloseIfValid(ref stderrWrite);
            CloseIfValid(ref nul);

            failureStage = "wait-job";
            Stopwatch timer = Stopwatch.StartNew();
            while (stopStatus == null && GetActiveProcessCount(job) > 0)
            {
                if (budget.Overflow.WaitOne(0)) { stopStatus = "output-limit"; break; }
                bool cancel = false;
                try { cancel = isCancelled(); } catch { cancel = true; }
                if (cancel) { stopStatus = "cancelled"; break; }
                if (timer.ElapsedMilliseconds >= timeoutMs) { stopStatus = "timeout"; break; }
                Thread.Sleep(20);
            }
            if (stopStatus == null && budget.Overflow.WaitOne(0)) stopStatus = "output-limit";

            if (stopStatus != null)
            {
                if (!TerminateJobObject(job, 1) || !WaitForEmpty(job, 10000))
                    throw new InvalidOperationException("Job termination was not confirmed.");
            }
            else if (GetActiveProcessCount(job) != 0)
                throw new InvalidOperationException("Job completion was not confirmed.");

            failureStage = "drain-output";
            if (stdoutTask == null || stderrTask == null ||
                !Task.WaitAll(new Task[] { stdoutTask, stderrTask }, 5000))
                throw new InvalidOperationException("Output drain was not confirmed.");

            uint exitCode;
            if (!GetExitCodeProcess(process.Process, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());

            outcome.Status = stopStatus ?? "completed";
            outcome.ErrorCode = stopStatus;
            outcome.ExitCode = unchecked((int)exitCode);
            outcome.FailureStage = null;
            if (stopStatus == null)
            {
                outcome.Stdout = stdoutBuffer.ToArray();
                outcome.Stderr = stderrBuffer.ToArray();
            }
            outcome.CleanupConfirmed = GetActiveProcessCount(job) == 0;
            safeToDelete = outcome.CleanupConfirmed;
        }
        catch
        {
            outcome.Status = "launcher-failed";
            outcome.ErrorCode = "launcher-failed";
            outcome.FailureStage = failureStage;
            outcome.Stdout = new byte[0];
            outcome.Stderr = new byte[0];
            if (job != IntPtr.Zero && assigned)
            {
                try { TerminateJobObject(job, 1); } catch { }
                outcome.CleanupConfirmed = WaitForEmpty(job, 10000);
            }
            else if (processCreated)
            {
                try { TerminateProcess(process.Process, 1); } catch { }
                outcome.CleanupConfirmed = WaitForSingleObject(process.Process, 5000) == WaitObject0;
            }
            else
                outcome.CleanupConfirmed = true;
            safeToDelete = outcome.CleanupConfirmed;
        }
        finally
        {
            CloseIfValid(ref stdoutWrite);
            CloseIfValid(ref stderrWrite);
            CloseIfValid(ref stdoutRead);
            CloseIfValid(ref stderrRead);
            CloseIfValid(ref nul);
            if (attributeList != IntPtr.Zero) DeleteProcThreadAttributeList(attributeList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (inheritedHandles != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandles);
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (!safeToDelete) outcome.CleanupConfirmed = false;
        }
        return outcome;
    }

    private static string QuoteArgument(string value)
    {
        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                quoted.Append('\\', slashes * 2 + 1);
                quoted.Append('"');
                slashes = 0;
                continue;
            }
            quoted.Append('\\', slashes);
            slashes = 0;
            quoted.Append(character);
        }
        quoted.Append('\\', slashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static uint GetActiveProcessCount(IntPtr job)
    {
        AccountingInformation accounting;
        uint returned;
        if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out accounting,
            (uint)Marshal.SizeOf(typeof(AccountingInformation)), out returned))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return accounting.ActiveProcesses;
    }

    private static bool WaitForEmpty(IntPtr job, int timeoutMs)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < timeoutMs)
        {
            try { if (GetActiveProcessCount(job) == 0) return true; }
            catch { return false; }
            Thread.Sleep(20);
        }
        try { return GetActiveProcessCount(job) == 0; } catch { return false; }
    }

    private static void CloseIfValid(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        handle = IntPtr.Zero;
    }
}
"@

$response = $null
$directory = $null
$directoryOwned = $false
$safeToDelete = $true
$stage = 'runtime'

function Assert-PrivateAcl($acl, $sid) {
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
        throw 'private-storage-unavailable'
    }
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $hasUserFull = $false
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -ne $sid.Value) {
            throw 'private-storage-unavailable'
        }
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny -and
            $rule.IdentityReference.Value -eq $sid.Value) {
            throw 'private-storage-unavailable'
        }
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -eq $sid.Value -and
            ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
                [Security.AccessControl.FileSystemRights]::FullControl) {
            $hasUserFull = $true
        }
    }
    if (-not $hasUserFull) { throw 'private-storage-unavailable' }
}

try {
    if ($env:OS -ne 'Windows_NT' -or $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
        throw 'unsupported-runtime'
    }
    $stage = 'compile'
    Add-Type -TypeDefinition $nativeSource -ErrorAction Stop | Out-Null

    $stage = 'read-request'
    $requestLine = [Console]::In.ReadLine()
    if ([string]::IsNullOrEmpty($requestLine) -or $requestLine.Length -gt 2000000) { throw 'invalid-request' }
    $request = $requestLine | ConvertFrom-Json -ErrorAction Stop
    if ($request.timeoutMs -lt 1 -or $request.timeoutMs -gt 300000 -or
        $request.maxOutputBytes -lt 1024 -or $request.maxOutputBytes -gt 1048576 -or
        $request.imageMimeType -notin @('image/png', 'image/jpeg') -or
        [string]::IsNullOrEmpty($request.imageBase64) -or
        $request.imageBase64.Length -gt 1333336 -or
        [string]::IsNullOrEmpty($request.executable) -or
        [string]::IsNullOrEmpty($request.cwd) -or
        $request.cwd -notmatch '^[A-Za-z]:\\') {
        throw 'invalid-request'
    }

    $stage = 'validate-image'
    $imageBytes = [Convert]::FromBase64String($request.imageBase64)
    if ($imageBytes.Length -lt 1 -or $imageBytes.Length -gt 1000000) { throw 'invalid-image' }
    $stage = 'get-temp-root'
    $tempRoot = [IO.Path]::GetTempPath()
    if ($request.directoryName -notmatch '^bricklab-copilot-[a-f0-9]{32}$' -or
        $request.cancelSignalName -notmatch '^bricklab-copilot-cancel-[a-f0-9]{32}\.signal$') {
        throw 'invalid-request'
    }
    $stage = 'directory-path'
    $directory = Join-Path $tempRoot $request.directoryName
    $cancelSignalPath = Join-Path $tempRoot $request.cancelSignalName
    $stage = 'directory-acl'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $directoryAcl = New-Object Security.AccessControl.DirectorySecurity
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.SetOwner($sid)
    $userRule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $directoryAcl.AddAccessRule($userRule)
    $stage = 'create-directory'
    [BrickLabJobHost]::CreatePrivateDirectory($directory, $directoryAcl.GetSecurityDescriptorBinaryForm())
    $directoryOwned = $true
    if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'private-storage-unavailable'
    }
    $stage = 'verify-directory-acl'
    $actualDirectoryAcl = [System.IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]$directory)
    if (-not $actualDirectoryAcl.AreAccessRulesProtected) { throw 'private-storage-unavailable' }
    Assert-PrivateAcl $actualDirectoryAcl $sid
    $path = Join-Path $directory $(if ($request.imageMimeType -eq 'image/png') { 'image.png' } else { 'image.jpg' })
    $stage = 'create-attachment'
    $fileStream = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stage = 'verify-private-acl'
        if (([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'private-storage-unavailable'
        }
        $fileAcl = [System.IO.FileSystemAclExtensions]::GetAccessControl($fileStream)
        Assert-PrivateAcl $fileAcl $sid
        $stage = 'write-attachment'
        $fileStream.Write($imageBytes, 0, $imageBytes.Length)
        $fileStream.Flush($true)
    } finally { $fileStream.Dispose() }

    $cancelled = [Func[bool]] { [IO.File]::Exists($cancelSignalPath) }
    if ($cancelled.Invoke()) {
        $execution = [pscustomobject]@{
            Status = 'cancelled'; ErrorCode = 'cancelled'; ExitCode = -1
            Stdout = [byte[]]@(); Stderr = [byte[]]@(); CleanupConfirmed = $true
        }
    } else {
        $safeToDelete = $false
        $stage = 'launch-copilot'
        $execution = [BrickLabJobHost]::Run(
            [string]$request.executable, [string[]]$request.args, $path, [string]$request.cwd,
            [int]$request.timeoutMs, [int]$request.maxOutputBytes, $cancelled)
        $safeToDelete = $execution.CleanupConfirmed
    }

    if (-not $safeToDelete) {
        $response = [ordered]@{ ok = $false; status = 'cleanup-unconfirmed'; cleanupConfirmed = $false }
    } elseif ($execution.Status -eq 'cancelled') {
        $response = [ordered]@{ ok = $false; status = 'cancelled'; cleanupConfirmed = $true }
    } elseif ($execution.Status -eq 'timeout') {
        $response = [ordered]@{ ok = $false; status = 'timeout'; cleanupConfirmed = $true }
    } elseif ($execution.Status -eq 'output-limit') {
        $response = [ordered]@{ ok = $false; status = 'output-limit'; cleanupConfirmed = $true }
    } elseif ($execution.Status -ne 'completed') {
        $response = [ordered]@{ ok = $false; status = 'launcher-failed'; cleanupConfirmed = $true; failureStage = $execution.FailureStage }
    } else {
        $response = [ordered]@{
            ok = $true
            status = 'completed'
            cleanupConfirmed = $true
            privateAclVerified = $true
            exitCode = $execution.ExitCode
            stdoutBase64 = [Convert]::ToBase64String($execution.Stdout)
            stderrBase64 = [Convert]::ToBase64String($execution.Stderr)
        }
    }
} catch {
    if ($null -eq $response) {
        $response = [ordered]@{ ok = $false; status = 'launcher-failed'; cleanupConfirmed = $safeToDelete; failureStage = $stage }
    }
} finally {
    if ($directoryOwned -and $safeToDelete) {
        try {
            if (Test-Path -LiteralPath $directory) {
                Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction Stop
            }
        } catch {
            $response = [ordered]@{ ok = $false; status = 'attachment-cleanup-failed'; cleanupConfirmed = $false }
        }
    }
}

try {
    $json = ConvertTo-Json -InputObject $response -Compress -Depth 4
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    [Console]::Out.WriteLine('BRICKLAB_JOB_RESULT:' + $encoded)
} catch {
    [Console]::Out.WriteLine('BRICKLAB_JOB_RESULT:')
    exit 1
}
