// Analyze Windows minidump (.dmp) files — pure Node.js, no external deps.
// Handles both full user-mode dumps and Breakpad/Crashpad minidumps.
// Usage: node scripts/analyze-dmp.mjs <path-to.dmp> [options]
//   --strings       Print all readable strings found in the dump
//   --dump-memory   Extract raw memory regions (large output!)
//   --cdb           Auto-run cdb.exe if available
import { readFileSync, statSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// ── MINIDUMP stream type constants ──
const STREAM = {
  UnusedStream: 0,
  ReservedStream0: 1,
  ReservedStream1: 2,
  ThreadListStream: 3,
  ModuleListStream: 4,
  MemoryListStream: 5,
  ExceptionStream: 6,
  SystemInfoStream: 7,
  ThreadExListStream: 8,
  Memory64ListStream: 9,
  CommentStreamA: 10,
  CommentStreamW: 11,
  HandleDataStream: 12,
  FunctionTableStream: 13,
  UnloadedModuleListStream: 14,
  MiscInfoStream: 15,
  MemoryInfoListStream: 16,
  ThreadInfoListStream: 17,
  HandleOperationListStream: 18,
  TokenStream: 19,
  JavascriptDataStream: 20,
  SystemMemoryInfoStream: 21,
  ProcessVmCountersStream: 22,
  BreakpadInfoStream: 0x4000,
  AssertionInfoStream: 0x7fff,
};

const STREAM_NAMES = {};
for (const [k, v] of Object.entries(STREAM)) STREAM_NAMES[v] = k;

// ── Processor architecture constants ──
const CPU = {
  0: 'Intel 386', 1: 'MIPS', 2: 'Alpha', 3: 'PowerPC',
  5: 'ARM', 6: 'Itanium', 9: 'AMD64', 12: 'ARM64',
  0xFFFF: 'Unknown',
};

// ── Read helpers ──
function u16(buf, off) { return buf.readUInt16LE(off); }
function u32(buf, off) { return buf.readUInt32LE(off); }
function u64(buf, off) {
  const lo = buf.readUInt32LE(off);
  const hi = buf.readUInt32LE(off + 4);
  return lo + hi * 0x100000000;
}
function p64(buf, off) {
  const lo = buf.readUInt32LE(off);
  const hi = buf.readUInt32LE(off + 4);
  return `0x${(hi * 0x100000000 + lo).toString(16).padStart(16, '0')}`;
}
function str(buf, off, maxLen) {
  let end = off;
  while (end < buf.length && buf[end] !== 0 && (end - off) < maxLen) end++;
  return buf.toString('utf8', off, end);
}
function wstr(buf, off, maxLen) {
  let end = off;
  while (end + 1 < buf.length && (buf[end] !== 0 || buf[end + 1] !== 0) && (end - off) < maxLen * 2) end += 2;
  return buf.toString('utf16le', off, end);
}

// ── Timestamp ──
function timestamp(ts) {
  try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19); } catch { return `${ts}`; }
}

class Minidump {
  constructor(buf, filePath) {
    this.buf = buf;
    this.filePath = filePath;
    this.size = buf.length;
    this.streams = new Map(); // streamType -> { dataSize, dataOffset, dir }
    this.modules = [];
    this.threads = [];
    this.memoryRegions = [];
    this.exception = null;
    this.systemInfo = null;
    this.miscInfo = null;
    this.memoryInfo = null;
    this.processVmCounters = null;
    this.breakpadInfo = null;
    this.commentA = null;
    this.commentW = null;
  }

  parse() {
    if (this.size < 32) throw new Error('File too small to be a valid minidump');

    const sig = u32(this.buf, 0);
    if (sig !== 0x504d444d) {
      throw new Error(`Invalid minidump signature: 0x${sig.toString(16)} (expected MDMP = 0x504d444d)`);
    }

    const version = u32(this.buf, 4);
    this.versionMajor = (version >> 16) & 0xffff;
    this.versionMinor = version & 0xffff;
    this.numStreams = u32(this.buf, 8);
    this.streamDirRva = u32(this.buf, 12);
    this.checkSum = u32(this.buf, 16);
    this.timeDateStamp = u32(this.buf, 20);
    this.flags = u64(this.buf, 24);

    // Parse stream directory
    let off = this.streamDirRva;
    for (let i = 0; i < this.numStreams; i++) {
      const streamType = u32(this.buf, off);
      const dataSize = u32(this.buf, off + 4);
      const rva = u32(this.buf, off + 8);
      this.streams.set(streamType, { dataSize, dataOffset: rva });
      off += 12;
    }

    // Parse each stream
    this._parseSystemInfo();
    this._parseModuleList();
    this._parseThreadList();
    this._parseException();
    this._parseMemoryList();
    this._parseMemory64List();
    this._parseMiscInfo();
    this._parseMemoryInfoList();
    this._parseProcessVmCounters();
    this._parseBreakpadInfo();
    this._parseComments();

    return this;
  }

  _parseSystemInfo() {
    const s = this.streams.get(STREAM.SystemInfoStream);
    if (!s) return;
    const off = s.dataOffset;
    const arch = u16(this.buf, off);
    const procLevel = u16(this.buf, off + 2);
    const numCPUs = this.buf.readUInt8(off + 4);
    const osType = this.buf.readUInt8(off + 5);
    const majorVer = u32(this.buf, off + 8);
    const minorVer = u32(this.buf, off + 12);
    const buildNum = u32(this.buf, off + 16);
    const platformId = u32(this.buf, off + 20);
    const csdVerRva = u32(this.buf, off + 24);

    let csd = '';
    if (csdVerRva > 0 && csdVerRva + 4 < this.size) {
      const csdLen = u32(this.buf, csdVerRva);
      const cpy = Buffer.alloc(csdLen);
      this.buf.copy(cpy, 0, csdVerRva + 4, Math.min(csdVerRva + 4 + csdLen, this.size));
      csd = cpy.toString('utf16le', 0, Math.floor(csdLen / 2)).replace(/\0/g, '');
    }

    this.systemInfo = {
      processorArchitecture: CPU[arch] || `Unknown (${arch})`,
      processorLevel: procLevel,
      numberOfProcessors: numCPUs,
      osType,
      osVersion: `${majorVer}.${minorVer}.${buildNum}`,
      platformId: platformId === 2 ? 'Windows' : platformId === 1 ? 'macOS' : platformId === 3 ? 'Linux' : `Platform(${platformId})`,
      csdVersion: csd,
    };
  }

  _parseModuleList() {
    let s = this.streams.get(STREAM.ModuleListStream);
    if (!s) s = this.streams.get(STREAM.UnloadedModuleListStream);
    if (!s) return;
    const off = s.dataOffset;
    const count = u32(this.buf, off);
    let pos = off + 4;
    for (let i = 0; i < count; i++) {
      const baseAddr = u64(this.buf, pos);
      const sizeOfImage = u32(this.buf, pos + 8);
      const checkSum = u32(this.buf, pos + 12);
      const timeDateStamp = u32(this.buf, pos + 16);
      const nameRva = u32(this.buf, pos + 20);

      // Read module name (RVA to MINIDUMP_STRING)
      let modName = '';
      if (nameRva > 0 && nameRva + 4 < this.size) {
        const nameLen = u32(this.buf, nameRva);
        const cpy = Buffer.alloc(nameLen);
        this.buf.copy(cpy, 0, nameRva + 4, Math.min(nameRva + 4 + nameLen, this.size));
        modName = cpy.toString('utf16le', 0, Math.floor(nameLen / 2)).replace(/\0/g, '');
      }

      const vsFixFileInfoOff = pos + 24 + 8; // skip cvRecord + miscRecord
      // Skip past for now, 24 bytes for version info
      const versionInfo = {
        dwSignature: u32(this.buf, pos + 24),
        dwStrucVersion: u32(this.buf, pos + 28),
        dwFileVersionMS: u32(this.buf, pos + 32),
        dwFileVersionLS: u32(this.buf, pos + 36),
        dwProductVersionMS: u32(this.buf, pos + 40),
        dwProductVersionLS: u32(this.buf, pos + 44),
      };

      this.modules.push({
        name: modName,
        baseAddr: `0x${baseAddr.toString(16).padStart(16, '0')}`,
        sizeOfImage,
        checkSum,
        timeDateStamp: timestamp(timeDateStamp),
        version: `${versionInfo.dwFileVersionMS >>> 16}.${versionInfo.dwFileVersionMS & 0xffff}.${versionInfo.dwFileVersionLS >>> 16}.${versionInfo.dwFileVersionLS & 0xffff}`,
      });

      // Module entry size: base(8)+size(4)+check(4)+stamp(4)+name(4)+info(4*20)+cv(4)+misc(4) = 108
      pos += 108;
    }
  }

  _parseThreadList() {
    let s = this.streams.get(STREAM.ThreadListStream);
    if (!s) s = this.streams.get(STREAM.ThreadExListStream);
    if (!s) s = this.streams.get(STREAM.ThreadInfoListStream);
    if (!s) return;
    const off = s.dataOffset;
    const count = u32(this.buf, off);
    let pos = off + 4;

    // Thread entry is 48 bytes for ThreadListStream, 56 for ThreadExListStream
    const streamType = [...this.streams.keys()].find(k => k === STREAM.ThreadListStream || k === STREAM.ThreadExListStream);
    const entrySize = streamType === STREAM.ThreadExListStream ? 56 : 48;

    for (let i = 0; i < Math.min(count, 200); i++) {
      const threadId = u32(this.buf, pos);
      const suspendCount = u32(this.buf, pos + 4);
      const priorityClass = u32(this.buf, pos + 8);
      const priority = u32(this.buf, pos + 12);
      const teb = u64(this.buf, pos + 16);
      const stackAddr = u64(this.buf, pos + 24);
      const stackSize = u64(this.buf, pos + 32);
      const contextRva = u32(this.buf, pos + 40);

      this.threads.push({
        threadId,
        suspendCount,
        priorityClass,
        priority,
        teb: `0x${teb.toString(16).padStart(16, '0')}`,
        stackStart: `0x${stackAddr.toString(16).padStart(16, '0')}`,
        stackSize,
      });
      pos += entrySize;
    }
  }

  _parseException() {
    const s = this.streams.get(STREAM.ExceptionStream);
    if (!s) return;
    const off = s.dataOffset;
    const threadId = u32(this.buf, off);
    const reserved = u32(this.buf, off + 4);
    const exceptionCode = u32(this.buf, off + 8);
    const exceptionFlags = u32(this.buf, off + 12);
    const exceptionRecord = u64(this.buf, off + 16);
    const exceptionAddress = u64(this.buf, off + 24);
    const numParameters = u32(this.buf, off + 32);
    const params = [];
    for (let i = 0; i < Math.min(numParameters, 15); i++) {
      params.push(p64(this.buf, off + 40 + i * 8));
    }

    const EXCEPTION_CODES = {
      0xC0000005: 'ACCESS_VIOLATION',
      0xC0000094: 'INTEGER_DIVIDE_BY_ZERO',
      0xC00000FD: 'STACK_OVERFLOW',
      0xC0000008: 'INVALID_HANDLE',
      0xC0000135: 'DLL_NOT_FOUND',
      0xC0000142: 'DLL_INIT_FAILED',
      0xC0000017: 'NOT_ENOUGH_MEMORY',
      0xE06D7363: 'CPP_EXCEPTION (msvcrt)',
      0x80000003: 'BREAKPOINT',
      0xC000001D: 'ILLEGAL_INSTRUCTION',
      0xC0000025: 'NONCONTINUABLE_EXCEPTION',
      0xC0000026: 'INVALID_DISPOSITION',
      0xC000008C: 'ARRAY_BOUNDS_EXCEEDED',
      0xC000008D: 'FLOAT_DENORMAL_OPERAND',
      0xC000008E: 'FLOAT_DIVIDE_BY_ZERO',
      0xC000008F: 'FLOAT_INEXACT_RESULT',
      0xC0000090: 'FLOAT_INVALID_OPERATION',
      0xC0000091: 'FLOAT_OVERFLOW',
      0xC0000092: 'FLOAT_STACK_CHECK',
      0xC0000093: 'FLOAT_UNDERFLOW',
      0xC0000095: 'INTEGER_OVERFLOW',
      0xC0000096: 'PRIVILEGED_INSTRUCTION',
      0xC00000FD: 'STACK_OVERFLOW',
      0xC0000139: 'ENTRY_POINT_NOT_FOUND',
    };

    this.exception = {
      threadId,
      exceptionCode: `0x${exceptionCode.toString(16)} (${EXCEPTION_CODES[exceptionCode] || 'Unknown'})`,
      exceptionFlags,
      exceptionAddress: `0x${exceptionAddress.toString(16).padStart(16, '0')}`,
      numParameters,
      parameters: params,
      kind: EXCEPTION_CODES[exceptionCode] || 'UNKNOWN',
    };
  }

  _parseMemoryList() {
    const s = this.streams.get(STREAM.MemoryListStream);
    if (!s) return;
    const off = s.dataOffset;
    const count = u32(this.buf, off);
    let pos = off + 4;
    for (let i = 0; i < count; i++) {
      const startAddr = u64(this.buf, pos);
      const dataSize = u32(this.buf, pos + 8);
      const rva = u32(this.buf, pos + 12);
      this.memoryRegions.push({ startAddr: `0x${startAddr.toString(16).padStart(16, '0')}`, dataSize, rva });
      pos += 16;
    }
  }

  _parseMemory64List() {
    const s = this.streams.get(STREAM.Memory64ListStream);
    if (!s) return;
    const off = s.dataOffset;
    const count = u64(this.buf, off);
    let baseRva = u64(this.buf, off + 8);
    let pos = off + 16;
    for (let i = 0; i < count; i++) {
      const startAddr = u64(this.buf, pos);
      const dataSize = u64(this.buf, pos + 8);
      this.memoryRegions.push({ startAddr: `0x${startAddr.toString(16).padStart(16, '0')}`, dataSize, rva: baseRva });
      baseRva += Number(dataSize);
      pos += 16;
    }
  }

  _parseMiscInfo() {
    const s = this.streams.get(STREAM.MiscInfoStream);
    if (!s) return;
    const off = s.dataOffset;
    const size = u32(this.buf, off);
    const flags1 = u32(this.buf, off + 4);   // Flags1, NOT at +8
    const processId = u32(this.buf, off + 8); // ProcessId
    const createTime = u32(this.buf, off + 12);
    this.miscInfo = { size, flags1, processId, processCreateTime: timestamp(createTime) };
    // For MINIDUMP_MISC_INFO_4 and above, ProcessName[512] is at the end
    if ((flags1 & 1) && s.dataSize > 1024) {
      const nameOff = off + s.dataSize - 1024; // 512 WCHARs
      if (nameOff > 0) {
        const cpy = Buffer.alloc(1024);
        this.buf.copy(cpy, 0, nameOff, Math.min(nameOff + 1024, this.size));
        this.miscInfo.processName = cpy.toString('utf16le', 0, 512).replace(/\0/g, '');
      }
    }
  }

  _parseMemoryInfoList() {
    const s = this.streams.get(STREAM.MemoryInfoListStream);
    if (!s) return;
    const off = s.dataOffset;
    const sizeOfEntry = u32(this.buf, off + 4);
    const count = u64(this.buf, off + 8);
    let pos = off + 16;
    const entries = [];
    const MEM_TYPE_NAMES = {
      [0x1000000]: 'MEM_IMAGE',
      [0x40000]: 'MEM_MAPPED',
      [0x20000]: 'MEM_PRIVATE',
    };
    for (let i = 0; i < Math.min(count, 100000); i++) {
      const baseAddr = u64(this.buf, pos);
      const allocBase = u64(this.buf, pos + 8);
      const allocProtect = u32(this.buf, pos + 16);
      const regionSize = u64(this.buf, pos + 24);
      const state = u32(this.buf, pos + 32);
      const protect = u32(this.buf, pos + 36);
      const type = u32(this.buf, pos + 40);
      if (state === 0x1000) { // MEM_COMMIT
        entries.push({
          baseAddr: `0x${baseAddr.toString(16).padStart(16, '0')}`,
          size: regionSize,
          state: state === 0x1000 ? 'MEM_COMMIT' : state === 0x2000 ? 'MEM_RESERVE' : 'MEM_FREE',
          type: MEM_TYPE_NAMES[type] || `Unknown(0x${type.toString(16)})`,
        });
      }
      pos += Number(sizeOfEntry);
    }
    this.memoryInfo = entries;
  }

  _parseProcessVmCounters() {
    const s = this.streams.get(STREAM.ProcessVmCountersStream);
    if (!s) return;
    const off = s.dataOffset;
    // MINIDUMP_PROCESS_VM_COUNTERS layout:
    //   USHORT Size(0), VersionMajor(2), VersionMinor(4), Reserved(6)
    //   ULONG64 ResidentSetSize(8), PeakWorkingSetSize(16), WorkingSetSize(24)
    //   ULONG64 QuotaPeakPagedPoolUsage(32), QuotaPagedPoolUsage(40)
    //   ULONG64 QuotaPeakNonPagedPoolUsage(48), QuotaNonPagedPoolUsage(56)
    //   ULONG64 PagefileUsage(64), PeakPagefileUsage(72), PrivateUsage(80)
    this.processVmCounters = {
      residentSetSize: u64(this.buf, off + 8),
      peakWorkingSetSize: u64(this.buf, off + 16),
      workingSetSize: u64(this.buf, off + 24),
      quotaPeakPagedPoolUsage: u64(this.buf, off + 32),
      quotaPagedPoolUsage: u64(this.buf, off + 40),
      quotaPeakNonPagedPoolUsage: u64(this.buf, off + 48),
      quotaNonPagedPoolUsage: u64(this.buf, off + 56),
      pagefileUsage: u64(this.buf, off + 64),
      peakPagefileUsage: u64(this.buf, off + 72),
      privateUsage: u64(this.buf, off + 80),
    };
  }

  _parseBreakpadInfo() {
    const s = this.streams.get(STREAM.BreakpadInfoStream);
    if (!s) return;
    const off = s.dataOffset;
    this.breakpadInfo = {
      validity: u32(this.buf, off),
      dumpThreadId: u32(this.buf, off + 4),
      requestedThreadId: u32(this.buf, off + 8),
    };
  }

  _parseComments() {
    const sA = this.streams.get(STREAM.CommentStreamA);
    if (sA) {
      this.commentA = this.buf.toString('utf8', sA.dataOffset, sA.dataOffset + Math.min(sA.dataSize, 1000)).replace(/\0/g, '');
    }
    const sW = this.streams.get(STREAM.CommentStreamW);
    if (sW && sW.dataSize < 2000) {
      const cpy = Buffer.alloc(sW.dataSize);
      this.buf.copy(cpy, 0, sW.dataOffset, sW.dataOffset + sW.dataSize);
      this.commentW = cpy.toString('utf16le', 0, Math.floor(sW.dataSize / 2)).replace(/\0/g, '');
    }
  }

  // ── Report generation ──

  summary() {
    const lines = [];
    lines.push('='.repeat(70));
    lines.push('  MINIDUMP ANALYSIS REPORT');
    lines.push('='.repeat(70));
    lines.push(`  File:        ${this.filePath}`);
    lines.push(`  Size:        ${fmtSize(this.size)}`);
    lines.push(`  Created:     ${timestamp(this.timeDateStamp)}`);
    lines.push(`  Dump flags:  0x${this.flags.toString(16)}`);
    lines.push(`  Version:     ${this.versionMajor}.${this.versionMinor}`);
    lines.push(`  Streams:     ${this.numStreams}`);
    lines.push('');

    if (this.systemInfo) {
      lines.push('  ── System Info ──');
      lines.push(`    OS:          ${this.systemInfo.platformId} ${this.systemInfo.osVersion} ${this.systemInfo.csdVersion}`);
      lines.push(`    CPU:         ${this.systemInfo.processorArchitecture} (level ${this.systemInfo.processorLevel})`);
      lines.push(`    Processors:  ${this.systemInfo.numberOfProcessors}`);
      lines.push('');
    }

    if (this.exception) {
      lines.push('  ⚠ CRASH / EXCEPTION');
      lines.push(`    Thread:      ${this.exception.threadId}`);
      lines.push(`    Code:        ${this.exception.exceptionCode}`);
      lines.push(`    Address:     ${this.exception.exceptionAddress}`);
      lines.push(`    Flags:       ${this.exception.exceptionFlags}`);
      lines.push('');
    }

    if (this.miscInfo) {
      lines.push('  ── Process Info ──');
      lines.push(`    Process ID:    ${this.miscInfo.processId}`);
      if (this.miscInfo.processName) lines.push(`    Name:          ${this.miscInfo.processName}`);
      lines.push(`    Created:       ${this.miscInfo.processCreateTime}`);
      lines.push('');
    }

    if (this.processVmCounters) {
      lines.push('  ── Process Memory Counters ──');
      lines.push(`    Resident Set:    ${fmtSize(this.processVmCounters.residentSetSize)}`);
      lines.push(`    Working Set:     ${fmtSize(this.processVmCounters.workingSetSize)}`);
      lines.push(`    Peak Working:    ${fmtSize(this.processVmCounters.peakWorkingSetSize)}`);
      lines.push(`    Private:         ${fmtSize(this.processVmCounters.privateUsage)}`);
      lines.push(`    Pagefile:        ${fmtSize(this.processVmCounters.pagefileUsage)}`);
      lines.push('');
    }

    lines.push(`  ── Modules (${this.modules.length}) ──`);
    const sigModules = this.modules.filter(m => m.name.toLowerCase().includes('electron') ||
      m.name.toLowerCase().includes('vibe') || m.name.toLowerCase().includes('node'));
    // Print interesting modules or just a summary
    if (sigModules.length > 0) {
      sigModules.forEach(m => lines.push(`    ${m.name}  (${fmtSize(m.sizeOfImage)} @ ${m.baseAddr})`));
    }
    // Also show top 10 largest modules
    const sortedMods = [...this.modules].sort((a, b) => b.sizeOfImage - a.sizeOfImage);
    lines.push(`    Top 5 largest:`);
    sortedMods.slice(0, 5).forEach(m => lines.push(`      ${fmtSize(m.sizeOfImage).padStart(8)} | ${m.name}`));
    lines.push('');

    lines.push(`  ── Threads (${this.threads.length}) ──`);
    this.threads.slice(0, 20).forEach(t => {
      lines.push(`    #${t.threadId}  stack:${fmtSize(t.stackSize)}  prio:${t.priority}  TEB:${t.teb}`);
    });
    if (this.threads.length > 20) lines.push(`    ... and ${this.threads.length - 20} more`);
    lines.push('');

    lines.push(`  ── Memory Regions (${this.memoryRegions.length}) ──`);
    const totalMem = this.memoryRegions.reduce((a, r) => a + Number(r.dataSize), 0);
    lines.push(`    Total in dump: ${fmtSize(totalMem)}`);
    lines.push('');

    if (this.memoryInfo) {
      const committed = this.memoryInfo.filter(e => e.state === 'MEM_COMMIT');
      const byType = new Map();
      committed.forEach(e => byType.set(e.type, (byType.get(e.type) || 0) + Number(e.size)));
      lines.push('  ── Committed Memory by Type ──');
      [...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, s]) => {
        lines.push(`    ${fmtSize(s).padStart(8)} | ${t}`);
      });
      lines.push(`    Total committed: ${fmtSize(committed.reduce((a, e) => a + Number(e.size), 0))}`);
      lines.push('');

      // Top 20 largest committed regions
      const sorted = [...committed].sort((a, b) => Number(b.size) - Number(a.size));
      lines.push('  ── Top 20 Largest Committed Regions ──');
      sorted.slice(0, 20).forEach((r, i) => {
        lines.push(`    #${i+1} ${fmtSize(r.size).padStart(8)} | ${r.type.padEnd(14)} | ${r.baseAddr}`);
      });
      lines.push(`    (${committed.length} committed regions total)`);
      lines.push('');
    }

    if (this.commentA) {
      lines.push(`  ── Comment (ANSI) ──`);
      lines.push(`    ${this.commentA.slice(0, 500)}`);

      lines.push('');
    }

    if (this.breakpadInfo) {
      lines.push(`  ── Breakpad/Crashpad Info ──`);
      lines.push(`    Dump thread ID:      ${this.breakpadInfo.dumpThreadId}`);
      lines.push(`    Requested thread ID: ${this.breakpadInfo.requestedThreadId}`);
      lines.push('');
    }

    lines.push(`  ── Stream Directory ──`);
    for (const [type, info] of this.streams) {
      lines.push(`    ${(STREAM_NAMES[type] || `Unknown(0x${type.toString(16)})`).padEnd(25)} ${fmtSize(info.dataSize).padStart(8)}  @ offset ${info.dataOffset}`);
    }

    lines.push('');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  // Dump all readable ASCII strings
  dumpStrings() {
    const SEARCH_BUF = this.buf.subarray(0, Math.min(this.size, 100 * 1024 * 1024)); // first 100MB
    const results = [];
    let start = -1;
    for (let i = 0; i < SEARCH_BUF.length; i++) {
      const b = SEARCH_BUF[i];
      if (b >= 32 && b <= 126) {
        if (start === -1) start = i;
      } else {
        if (start !== -1) {
          const len = i - start;
          if (len >= 15 && len <= 500) {
            results.push({ offset: start, str: SEARCH_BUF.toString('utf8', start, i) });
          }
          start = -1;
        }
      }
    }
    // Group by keyword
    const interesting = results.filter(r => {
      // Filter out V8 internal bytecode noise (short segments of V/digit/colon patterns)
      if (/^[Vv\d:\;\,\&\`\~\-\=\[\]\(\)\{\}\.\/\\]+$/.test(r.str)) return false;
      if (r.str.length < 20) return false;
      return /electron|vite|node_modules|monaco|react|xterm|chrome|chromium|\.exe|\.dll|process|heap|malloc|shared_memory|window|renderer|browser|\.tsx|\.ts|\.jsx|\.js|\.css|\.html|package\.json|manifest|config|sourceMappingURL|base64|codegraph/i.test(r.str);
    });
    console.log(`\n=== INTERESTING STRINGS (${interesting.length}/${results.length}) ===`);
    interesting.slice(0, 100).forEach(r => console.log(`  @${r.offset} | ${r.str.slice(0, 250)}`));
    if (interesting.length > 100) console.log(`  ... and ${interesting.length - 100} more`);
  }
}

function fmtSize(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}

// ── main ──
const file = process.argv[2];
const options = { strings: process.argv.includes('--strings'), dumpMemory: process.argv.includes('--dump-memory'), cdb: process.argv.includes('--cdb') };
if (!file) {
  console.error('Usage: node scripts/analyze-dmp.mjs <path-to.dmp> [--strings] [--dump-memory] [--cdb]');
  console.error('');
  console.error('  --strings      Extract readable strings from dump (10MB+ files will be slow)');
  console.error('  --dump-memory  Print all memory region boundaries (for full dumps only)');
  console.error('  --cdb          Auto-run cdb.exe if available for extended analysis');
  process.exit(1);
}

if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const stats = statSync(file);
const buf = readFileSync(file);

try {
  const md = new Minidump(buf, file).parse();
  console.log(md.summary());

  if (options.strings) md.dumpStrings();

  if (options.dumpMemory && md.memoryRegions.length > 0) {
    console.log(`\n=== MEMORY REGION BOUNDARIES (${md.memoryRegions.length}) ===`);
    md.memoryRegions.forEach(r => console.log(`  ${r.startAddr} - ${fmtSize(r.dataSize)} @ offset ${r.rva}`));
  }
} catch (err) {
  // If minidump parsing fails, try treating it as a raw memory dump
  if (err.message.includes('signature')) {
    console.error(`Not a valid minidump: ${err.message}`);
    console.error('\nFalling back to raw dump analysis...\n');
    rawDumpAnalysis(file, buf, stats);
  } else {
    console.error(`Minidump parse error: ${err.message}`);
    process.exit(1);
  }
}

function rawDumpAnalysis(file, buf, stats) {
  console.log('='.repeat(70));
  console.log('  RAW MEMORY DUMP ANALYSIS');
  console.log('='.repeat(70));
  console.log(`  File:  ${file}`);
  console.log(`  Size:  ${fmtSize(stats.size)}`);
  console.log(`  Time:  ${new Date(stats.mtime).toISOString()}`);
  console.log('');

  // Scan for process structures
  const PAGE_SIZE = 4096;
  const totalPages = Math.floor(buf.length / PAGE_SIZE);
  let mappedPages = 0;
  const regionSizes = [];

  let regionStart = -1;
  for (let i = 0; i < totalPages; i++) {
    const off = i * PAGE_SIZE;
    const blank = buf.slice(off, off + PAGE_SIZE).every(b => b === 0);
    if (!blank) {
      if (regionStart === -1) regionStart = i;
      mappedPages++;
    } else {
      if (regionStart !== -1) {
        regionSizes.push({ from: regionStart, to: i - 1, pages: i - regionStart, bytes: (i - regionStart) * PAGE_SIZE });
        regionStart = -1;
      }
    }
  }

  console.log(`  Total mapped pages: ${mappedPages} / ${totalPages} (${fmtSize(mappedPages * PAGE_SIZE)})`);
  console.log(`  Zero pages: ${totalPages - mappedPages} (${fmtSize((totalPages - mappedPages) * PAGE_SIZE)})`);

  // Top 10 largest regions
  regionSizes.sort((a, b) => b.bytes - a.bytes);
  regionSizes.slice(0, 10).forEach((r, i) => {
    console.log(`  Region #${i + 1}: page ${r.from}-${r.to} = ${fmtSize(r.bytes)}`);
  });

  // Scan for ASCII strings (like the minidump scanner)
  const strings = [];
  let start = -1;
  for (let i = 0; i < Math.min(buf.length, 50 * 1024 * 1024); i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) {
      if (start === -1) start = i;
    } else {
      if (start !== -1) {
        const len = i - start;
        if (len >= 15 && len <= 300) strings.push({ offset: start, str: buf.toString('utf8', start, i) });
        start = -1;
      }
    }
  }

  const interesting = strings.filter(r => {
    if (/^[Vv\d\;\:\.\,\&\`\~\-\=\[\]\(\)\{\}\.\/\\]+$/.test(r.str)) return false;
    if (r.str.length < 20) return false;
    return /electron|vite|node|monaco|react|xterm|chrome|v8|chromium|process|heap|malloc|shared_memory/i.test(r.str);
  });
  console.log(`\n  Interesting strings found: ${interesting.length}`);
  interesting.slice(0, 30).forEach(r => console.log(`    @0x${r.offset.toString(16)} | ${r.str.slice(0, 150)}`));

  // Scan for potential JS heap metadata
  console.log('\n  Scanning for V8 heap markers...');
  let heapPages = 0;
  for (let i = 0; i < totalPages; i++) {
    const off = i * PAGE_SIZE;
    if (buf[off] === 0x20 && buf[off + 1] === 0x20) heapPages++;
  }
  if (heapPages > 0) console.log(`    V8 heap page markers: ~${fmtSize(heapPages * PAGE_SIZE)} (approx.)`);
  else console.log('    No V8 heap markers found (dump may not contain full process memory)');

  console.log('');
  console.log('='.repeat(70));
  console.log('  To analyze with WinDbg:');
  console.log('    1. Install Windows SDK (developer.microsoft.com/windows/downloads/windows-sdk)');
  console.log('    2. Open "WinDbg (x64)" as administrator');
  console.log(`    3. File > Open Crash Dump > ${file}`);
  console.log('    4. In WinDbg, run: !analyze -v');
  console.log('    5. For V8/heap analysis: .loadby sos clr  (if .NET) or !heap -s');
  console.log('');
  console.log('  Quick CDB analysis (if installed):');
  console.log(`    cdb -z "${file}" -c "!analyze -v; lm; q"`);
  console.log('='.repeat(70));
}

// ── CDB integration ──
if (options.cdb) {
  const paths = [
    'cdb.exe',
    'C:/Program Files (x86)/Windows Kits/10/Debuggers/x64/cdb.exe',
    'C:/Program Files/Windows Kits/10/Debuggers/x64/cdb.exe',
    'C:/Program Files (x86)/Windows Kits/10/Debuggers/x86/cdb.exe',
  ];
  let cdbPath = null;
  for (const p of paths) {
    try { execSync(`${p} /? 2>nul >nul`, { stdio: 'ignore' }); cdbPath = p; break; } catch {}
  }
  if (!cdbPath) {
    // Search common locations
    try {
      const result = execSync('where cdb.exe 2>nul', { encoding: 'utf8' });
      cdbPath = result.split('\n')[0]?.trim() || null;
    } catch {}
  }
  if (cdbPath) {
    console.log(`\n⚠ cdb.exe found at: ${cdbPath}`);
    console.log('  Running !analyze -v...\n');
    try {
      const out = execSync(`"${cdbPath}" -z "${file}" -logo "c:\\temp\\cdb_analyze.log" -c "!analyze -v; lmD; q"`, { timeout: 60000, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
      console.log(out.slice(0, 2000));
      console.log('  ... Full output maybe at c:\\temp\\cdb_analyze.log');
    } catch (err) {
      console.error('cdb analysis failed:', err.message);
    }
  } else {
    console.log('\n⚠ cdb.exe not found. Install Windows Debugging Tools from the Windows SDK:');
    console.log('  https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/');
  }
}
