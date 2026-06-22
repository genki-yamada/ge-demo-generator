// Code.gs:1892 のインライン bashEscape を忠実移植（クォート囲みなし・String強制なし）
export const bashEscape = (str) => (str ? str.replace(/'/g, "'\\''") : '');

// Code.gs:1938-1943 の systemInstruction エスケープ連鎖を関数化
export function escapeForSystemInstruction(s) {
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\''")
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')
    .replace(/\n/g, '\\n');
}
