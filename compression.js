
// --- BITS ---
class BitWriter {
  constructor() {
    this.bytes = [];
    this.currentByte = 0;
    this.bitCount = 0;
  }

  writeBit(bit) {
    if (bit) this.currentByte |= (1 << (7 - this.bitCount));
    this.bitCount++;
    if (this.bitCount === 8) {
      this.bytes.push(this.currentByte);
      this.currentByte = 0;
      this.bitCount = 0;
    }
  }

  writeBits(strBits) {
    for (let i = 0; i < strBits.length; i++) {
      this.writeBit(strBits[i] === '1');
    }
  }

  flush() {
    if (this.bitCount > 0) this.bytes.push(this.currentByte);
    return Buffer.from(this.bytes);
  }
}

class BitReader {
  constructor(buffer) {
    this.data = buffer;
    this.byteIndex = 0;
    this.bitCount = 0;
  }

  readBit() {
    if (this.byteIndex >= this.data.length) return 0;
    const bit = (this.data[this.byteIndex] >> (7 - this.bitCount)) & 1;
    this.bitCount++;
    if (this.bitCount === 8) {
      this.bitCount = 0;
      this.byteIndex++;
    }
    return bit;
  }
}

// --- HUFFMAN ---
function buildHuffmanTree(frequencies) {
  const pq = [];
  for (let symbol in frequencies) {
    pq.push({ symbol: parseInt(symbol), freq: frequencies[symbol], left: null, right: null });
  }

  if (pq.length === 0) return null;
  if (pq.length === 1) return { symbol: null, freq: pq[0].freq, left: pq[0], right: null };

  while (pq.length > 1) {
    pq.sort((a, b) => a.freq - b.freq);
    const left = pq.shift();
    const right = pq.shift();
    pq.push({ symbol: null, freq: left.freq + right.freq, left, right });
  }
  return pq[0];
}

function generateCodes(node, currentCode = '', codes = {}) {
  if (!node) return;
  if (node.symbol !== null) {
    codes[node.symbol] = currentCode || '0';
    return;
  }
  generateCodes(node.left, currentCode + '0', codes);
  generateCodes(node.right, currentCode + '1', codes);
  return codes;
}

// --- LZ77 ---
function compressLZ77(buffer) {
  const out = [];
  let i = 0;
  const len = buffer.length;
  const windowSize = 4096;
  const maxMatchLength = 255;

  while (i < len) {
    let bestMatchDistance = 0;
    let bestMatchLength = 0;
    const searchStart = Math.max(0, i - windowSize);

    for (let j = searchStart; j < i; j++) {
      let matchLen = 0;
      while (
        i + matchLen < len &&
        matchLen < maxMatchLength &&
        buffer[j + matchLen] === buffer[i + matchLen]
      ) {
        matchLen++;
      }
      if (matchLen > bestMatchLength) {
        bestMatchLength = matchLen;
        bestMatchDistance = i - j;
      }
    }

    if (bestMatchLength >= 4) {
      out.push(0xAF);
      out.push((bestMatchDistance >> 8) & 0xFF);
      out.push(bestMatchDistance & 0xFF);
      out.push(bestMatchLength);
      i += bestMatchLength;
    } else {
      let literalBytes = [];
      let j = i;
      while (j < len && literalBytes.length < 255) {
        let lookAheadMatch = false;
        if (j + 3 < len) {
          const subSearchStart = Math.max(0, j - windowSize);
          for (let sj = subSearchStart; sj < j; sj++) {
            if (
              buffer[sj] === buffer[j] &&
              buffer[sj + 1] === buffer[j + 1] &&
              buffer[sj + 2] === buffer[j + 2] &&
              buffer[sj + 3] === buffer[j + 3]
            ) {
              lookAheadMatch = true;
              break;
            }
          }
        }
        if (lookAheadMatch) break;
        literalBytes.push(buffer[j]);
        j++;
      }

      if (literalBytes.length === 0) {
        literalBytes.push(buffer[i]);
        j = i + 1;
      }

      out.push(0xAE);
      out.push(literalBytes.length);
      out.push(...literalBytes);
      i = j;
    }
  }
  return Buffer.from(out);
}

function decompressLZ77(buffer) {
  const out = [];
  let i = 0;
  const len = buffer.length;

  while (i < len) {
    const marker = buffer[i++];
    if (i >= len) break;

    if (marker === 0xAE) {
      const literalLen = buffer[i++];
      for (let c = 0; c < literalLen; c++) {
        out.push(buffer[i++]);
      }
    } else if (marker === 0xAF) {
      const distHigh = buffer[i++];
      const distLow = buffer[i++];
      const distance = (distHigh << 8) | distLow;
      const matchLength = buffer[i++];
      const startPos = out.length - distance;

      for (let c = 0; c < matchLength; c++) {
        out.push(out[startPos + c]);
      }
    }
  }
  return Buffer.from(out);
}

// --- FULL COMPRESSION ---
function compressFull(buffer) {
  const lz77Data = compressLZ77(buffer);
  const freq = {};
  for (let i = 0; i < lz77Data.length; i++) {
    freq[lz77Data[i]] = (freq[lz77Data[i]] || 0) + 1;
  }

  const tree = buildHuffmanTree(freq);
  const codes = generateCodes(tree);
  const keys = Object.keys(freq);
  const writer = new BitWriter();

  const numSymbols = keys.length;
  const headerBytes = [(numSymbols >> 8) & 0xFF, numSymbols & 0xFF];

  for (let sym of keys) {
    headerBytes.push(parseInt(sym));
    const f = freq[sym];
    headerBytes.push((f >> 24) & 0xFF, (f >> 16) & 0xFF, (f >> 8) & 0xFF, f & 0xFF);
  }

  for (let i = 0; i < lz77Data.length; i++) {
    writer.writeBits(codes[lz77Data[i]]);
  }
  const huffmanBytes = writer.flush();

  return Buffer.concat([Buffer.from(headerBytes), huffmanBytes]);
}

function decompressFull(buffer) {
  let offset = 0;
  const numSymbols = (buffer[offset] << 8) | buffer[offset + 1];
  offset += 2;

  const freq = {};
  for (let i = 0; i < numSymbols; i++) {
    const sym = buffer[offset++];
    const f = (buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
    offset += 4;
    freq[sym] = f;
  }

  const tree = buildHuffmanTree(freq);
  const reader = new BitReader(buffer.subarray(offset));
  const lz77Data = [];

  let totalSymbols = 0;
  for (let sym in freq) totalSymbols += freq[sym];

  let currentNode = tree;
  while (lz77Data.length < totalSymbols) {
    const bit = reader.readBit();
    currentNode = bit === 0 ? currentNode.left : currentNode.right;

    if (currentNode && currentNode.symbol !== null) {
      lz77Data.push(currentNode.symbol);
      currentNode = tree;
    }
  }

  return decompressLZ77(Buffer.from(lz77Data));
}

module.exports = { compressFull, decompressFull };
