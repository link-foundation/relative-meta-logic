#requires -Version 5.1
# Windows PowerShell 5.1 process inventory for build-cache.mjs. Only stdout is
# JSON. A missing cwd means unknown, never an inference from command-line args.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class BuildCacheCwdResult
{
    public string cwd;
    public string state = "unknown";
    public string reason;
}

public static class BuildCacheWindowsCwd
{
    const uint QueryInformation = 0x0400, ReadMemory = 0x0010, Synchronize = 0x00100000;
    const uint WaitObject0 = 0, WaitTimeout = 258;
    const ushort MachineI386 = 0x014c, MachineAmd64 = 0x8664;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadProcessMemory(IntPtr process, IntPtr address,
        [Out] byte[] buffer, UIntPtr size, out UIntPtr bytesRead);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation,
        out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
        StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool IsWow64Process2(IntPtr process, out ushort processMachine,
        out ushort nativeMachine);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool IsWow64Process(IntPtr process, out bool wow64);
    [DllImport("kernel32.dll")]
    static extern void GetNativeSystemInfo([Out] byte[] information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);

    // The native query is resolved at runtime: Microsoft explicitly reserves the
    // right to change/remove it. PEB and RTL_USER_PROCESS_PARAMETERS are internal
    // layouts; validate their pointers, lengths and normalized flag before use.
    // https://learn.microsoft.com/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess
    // https://learn.microsoft.com/windows/win32/api/winternl/ns-winternl-peb
    // Layout sources (CURDIR.DosPath, RTL_USER_PROCESS_PARAMETERS, and PEB32):
    // https://github.com/winsiderss/systeminformer/blob/master/phnt/include/ntrtl.h
    // https://github.com/winsiderss/systeminformer/blob/master/phnt/include/ntwow64.h
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    delegate int QueryProcess(IntPtr process, int informationClass,
        [Out] byte[] information, uint size, out uint returned);

    static ulong Pointer(byte[] bytes, int offset, int width)
    {
        return width == 8 ? BitConverter.ToUInt64(bytes, offset)
                          : BitConverter.ToUInt32(bytes, offset);
    }

    static byte[] Read(IntPtr process, ulong address, int count)
    {
        if (address == 0 || count <= 0 || address > (ulong)long.MaxValue ||
            (IntPtr.Size == 4 && address > uint.MaxValue))
            throw new InvalidOperationException("Unsupported process pointer");
        IntPtr pointer = IntPtr.Size == 8 ? new IntPtr((long)address)
                                         : new IntPtr(unchecked((int)address));
        byte[] bytes = new byte[count];
        UIntPtr read;
        if (!ReadProcessMemory(process, pointer, bytes, new UIntPtr((uint)count), out read) ||
            read.ToUInt64() != (ulong)count)
            throw new InvalidOperationException("Cannot read complete process memory");
        return bytes;
    }

    static bool Equal(byte[] first, byte[] second)
    {
        if (first.Length != second.Length) return false;
        for (int i = 0; i < first.Length; i++)
            if (first[i] != second[i]) return false;
        return true;
    }

    static int PointerWidth(IntPtr process)
    {
        ushort machine, native;
        try
        {
            if (!IsWow64Process2(process, out machine, out native))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (native != MachineI386 && native != MachineAmd64)
                throw new InvalidOperationException("Unsupported native process architecture");
            ushort effective = machine == 0 ? native : machine;
            if (effective == MachineI386) return 4;
            if (effective == MachineAmd64 && IntPtr.Size == 8) return 8;
        }
        catch (EntryPointNotFoundException)
        {
            // Windows versions before IsWow64Process2. SYSTEM_INFO is 36/48
            // bytes on x86/x64; its first WORD is wProcessorArchitecture.
            byte[] info = new byte[48];
            GetNativeSystemInfo(info);
            ushort architecture = BitConverter.ToUInt16(info, 0);
            bool wow64;
            if (!IsWow64Process(process, out wow64))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (architecture == 0) return 4; // PROCESSOR_ARCHITECTURE_INTEL
            if (architecture == 9) // PROCESSOR_ARCHITECTURE_AMD64
            {
                if (wow64) return 4;
                if (IntPtr.Size == 8) return 8;
            }
        }
        // In particular, a 32-bit reader must not truncate a 64-bit address.
        throw new InvalidOperationException("Unsupported process/reader architecture");
    }

    static string CurrentDirectory(IntPtr process)
    {
        int width = PointerWidth(process);
        IntPtr symbol = GetProcAddress(GetModuleHandle("ntdll.dll"), "NtQueryInformationProcess");
        if (symbol == IntPtr.Zero)
            throw new InvalidOperationException("Native process query unavailable");
        QueryProcess query = (QueryProcess)Marshal.GetDelegateForFunctionPointer(symbol, typeof(QueryProcess));
        uint returned;
        ulong peb;
        if (IntPtr.Size == 8 && width == 4)
        {
            // ProcessWow64Information returns the WOW64 PEB32 address in a
            // host-sized ULONG_PTR, not the native PEB64 of the same process.
            byte[] wow = new byte[IntPtr.Size];
            if (query(process, 26, wow, (uint)wow.Length, out returned) < 0 || returned != wow.Length)
                throw new InvalidOperationException("Cannot query WOW64 process parameters");
            peb = Pointer(wow, 0, IntPtr.Size);
            if (peb > uint.MaxValue)
                throw new InvalidOperationException("Invalid WOW64 PEB pointer");
        }
        else
        {
            // PROCESS_BASIC_INFORMATION has six pointer-sized slots, with
            // PebBaseAddress in slot 1 (including x64 alignment padding).
            byte[] basic = new byte[6 * IntPtr.Size];
            if (query(process, 0, basic, (uint)basic.Length, out returned) < 0 || returned != basic.Length)
                throw new InvalidOperationException("Cannot query process parameters");
            peb = Pointer(basic, IntPtr.Size, IntPtr.Size);
        }

        // PEB.ProcessParameters: x86 +0x10, x64 +0x20.
        // RTL_USER_PROCESS_PARAMETERS.CurrentDirectory: x86 +0x24, x64 +0x38.
        // Its UNICODE_STRING has Length/MaximumLength WORDs and a pointer at
        // +4 (x86) / +8 (x64). These offsets are for x86/x64 only.
        int parametersOffset = width == 8 ? 0x20 : 0x10;
        int directoryOffset = width == 8 ? 0x38 : 0x24;
        int stringPointerOffset = width == 8 ? 8 : 4;
        int headerSize = directoryOffset + stringPointerOffset + width;
        ulong parameters = Pointer(Read(process, checked(peb + (uint)parametersOffset), width), 0, width);
        if (peb == 0 || parameters == 0 || parameters % (uint)width != 0)
            throw new InvalidOperationException("Uninitialized process parameters");
        byte[] header = Read(process, parameters, headerSize);
        uint maximum = BitConverter.ToUInt32(header, 0);
        uint length = BitConverter.ToUInt32(header, 4);
        uint flags = BitConverter.ToUInt32(header, 8);
        if (length < headerSize || maximum < length || (flags & 1) == 0)
            throw new InvalidOperationException("Unsupported process parameter layout");
        int byteLength = BitConverter.ToUInt16(header, directoryOffset);
        int byteMaximum = BitConverter.ToUInt16(header, directoryOffset + 2);
        ulong buffer = Pointer(header, directoryOffset + stringPointerOffset, width);
        if (byteLength == 0 || (byteLength & 1) != 0 || byteMaximum < byteLength || (buffer & 1) != 0)
            throw new InvalidOperationException("Invalid current-directory string");
        byte[] text = Read(process, buffer, byteLength);
        // SetCurrentDirectory can change both the descriptor and its buffer.
        // Do not use a torn snapshot or a replaced process-parameters block.
        if (!Equal(header, Read(process, parameters, headerSize)) ||
            !Equal(text, Read(process, buffer, byteLength)) ||
            parameters != Pointer(Read(process, checked(peb + (uint)parametersOffset), width), 0, width))
            throw new InvalidOperationException("Current directory changed during inspection");
        string cwd = new UnicodeEncoding(false, false, true).GetString(text);
        bool drivePath = cwd.Length >= 3 && char.IsLetter(cwd[0]) && cwd[1] == ':' && cwd[2] == '\\';
        bool uncPath = cwd.Length > 4 && cwd.StartsWith("\\\\", StringComparison.Ordinal);
        if (cwd.IndexOf('\0') >= 0 || (!drivePath && !uncPath))
            throw new InvalidOperationException("Current directory is not an absolute Windows path");
        return cwd;
    }

    public static BuildCacheCwdResult Inspect(uint processId, string expectedName, long expectedCreation)
    {
        BuildCacheCwdResult result = new BuildCacheCwdResult();
        IntPtr process = OpenProcess(QueryInformation | ReadMemory | Synchronize, false, processId);
        if (process == IntPtr.Zero)
        {
            result.reason = "Cannot open process: " + Marshal.GetLastWin32Error();
            return result;
        }
        bool identityVerified = false;
        try
        {
            long creation, exit, kernel, user;
            // CIM dates have microsecond precision, FILETIME has 100ns precision.
            // https://learn.microsoft.com/windows/win32/wmisdk/cim-datetime
            // Verify identity so a reused PID cannot borrow the old row's cwd.
            if (expectedCreation <= 0 || !GetProcessTimes(process, out creation, out exit, out kernel, out user) ||
                creation / 10 != expectedCreation / 10)
                throw new InvalidOperationException("Process identity could not be verified");
            identityVerified = true;
            if (WaitForSingleObject(process, 0) == WaitObject0)
            {
                result.state = "gone";
                return result;
            }
            StringBuilder image = new StringBuilder(32768);
            uint imageLength = (uint)image.Capacity;
            if (!QueryFullProcessImageName(process, 0, image, ref imageLength) ||
                !String.Equals(Path.GetFileName(image.ToString()), expectedName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Process executable could not be verified");
            result.cwd = CurrentDirectory(process);
            uint wait = WaitForSingleObject(process, 0);
            if (wait == WaitObject0)
            {
                result.cwd = null;
                result.state = "gone";
            }
            else if (wait == WaitTimeout) result.state = "live";
            else throw new InvalidOperationException("Process liveness could not be verified");
        }
        catch (Exception error)
        {
            result.cwd = null;
            result.reason = error.Message;
            // A failed memory read/access check is not evidence of exit.
            if (identityVerified && WaitForSingleObject(process, 0) == WaitObject0) result.state = "gone";
        }
        finally { CloseHandle(process); }
        return result;
    }
}
'@

$builder = '^(cargo|rustc|rustdoc|node|lake|lean|rocq|coqc|coq_makefile|make|docker)(\.exe)?$'
$inventory = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate)
$rows = @(foreach ($entry in $inventory) {
    $name = [System.IO.Path]::GetFileName([string]$entry.Name)
    $cwd = $null
    $state = 'unknown'
    $reason = $null
    if ($name -match $builder) {
        $created = 0L
        if ($null -ne $entry.CreationDate) { $created = $entry.CreationDate.ToUniversalTime().ToFileTimeUtc() }
        $probe = [BuildCacheWindowsCwd]::Inspect([uint32]$entry.ProcessId, $name, $created)
        $cwd = $probe.cwd
        $state = $probe.state
        $reason = $probe.reason
        if ($state -eq 'unknown') {
            try {
                # OpenProcess can fail after a process exits. Only a successful
                # fresh inventory proving this PID absent permits skipping it.
                $current = @(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [uint32]$entry.ProcessId) -Property ProcessId)
                if ($current.Count -eq 0) { $state = 'gone'; $reason = $null }
            } catch { <# Failure or access denial leaves the builder unknown. #> }
        }
    }
    # Nonbuilders are retained so the caller can walk the complete parent chain.
    [pscustomobject]@{
        pid = [long]$entry.ProcessId
        parent = [long]$entry.ParentProcessId
        executable = $name
        cwd = $cwd
        state = $state
        reason = $reason
    }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
