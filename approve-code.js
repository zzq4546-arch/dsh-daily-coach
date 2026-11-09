#!/usr/bin/env node
/*
 * approve-code.js — 给 dsh-daily-coach 的「审批模式」算审批码。
 *
 * 用法：
 *   node approve-code.js 2026-11-09 "今天补完 README，画了导入校验链路"
 *   node approve-code.js --check 2026-11-09 "备注" ABCD23
 *
 * 算法必须和 dsh-daily-coach/client.js 里的 expectedCode 完全一致：
 *   FNV-1a(32) over `${date}|${normalizedProof}|dsh-daily-coach`
 *   取低 5 位一组，映射到 alphabet，共 6 个字符。
 */

import { pathToFileURL } from 'node:url';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SALT = 'dsh-daily-coach';

export function normProof(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

export function fnv1a(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function expectedCode(key, proof) {
  let h = fnv1a(key + '|' + normProof(proof) + '|' + SALT);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[h & 31];
    h = h >>> 5;
  }
  return out;
}

function usage() {
  console.error('用法: node approve-code.js <YYYY-MM-DD> <备注...>');
  console.error('      node approve-code.js --check <YYYY-MM-DD> <备注...> <审批码>');
  process.exit(2);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length < 2) usage();

  let check = false;
  if (args[0] === '--check') { check = true; args.shift(); }

  const key = args[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) usage();

  let proof;
  let given = null;
  if (check) {
    if (args.length < 3) usage();
    given = args[args.length - 1];
    proof = args.slice(1, -1).join(' ');
  } else {
    proof = args.slice(1).join(' ');
  }
  if (!proof.trim()) usage();

  const code = expectedCode(key, proof);
  if (check) {
    const ok = String(given).toUpperCase() === code;
    console.log(ok ? 'OK ' + code : 'MISMATCH expected=' + code + ' given=' + given);
    process.exit(ok ? 0 : 1);
  }
  console.log(code);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main(process.argv);
