import { moment } from 'obsidian';

/**
 * Calculates a standard Git SHA-1 Hash: sha1("blob " + filesize + "\0" + filedata)
 */
export async function calculateGitSha(buffer: ArrayBuffer): Promise<string> {
  const header = new TextEncoder().encode(`blob ${buffer.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + buffer.byteLength);
  combined.set(header);
  combined.set(new Uint8Array(buffer), header.byteLength);
  
  const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(binary);
}

export function generateCommitMessage(hostname: string, format: string, files: string[]): string {
  const dateStr = moment().format(format);
  const host = hostname || 'Unknown-Device';
  const title = `Sync/Auto sync from ${host}: ${dateStr}`;
  const body = files.length > 0 ? `\n\nChanged files:\n${files.map(f => `- ${f}`).join('\n')}` : '';
  return title + body;
}

export function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return [
    'md', 'txt', 'json', 'css', 'js', 'ts', 'canvas',
    'yaml', 'yml', 'xml', 'html', 'htm', 'csv', 'svg',
    'toml', 'ini', 'cfg', 'env', 'gitignore', 'editorconfig',
    'license', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  ].includes(ext || '');
}

export function normalizeTextBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const text = new TextDecoder('utf-8').decode(buffer);
  const normalized = text.replace(/\r\n/g, '\n');
  return new TextEncoder().encode(normalized).buffer;
}