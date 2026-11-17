/* 诊断日志：宿主端在 Electron 里没有可见的 stdout，只能落到文件里自证。
 * 出问题时看 D:\DSH\home\calendar\register.log 即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import { paths } from './store.js'

export function diag(line) {
  try {
    fs.mkdirSync(paths.dir, { recursive: true })
    fs.appendFileSync(path.join(paths.dir, 'register.log'), new Date().toISOString() + '  ' + line + '\n', 'utf8')
  }
  catch (e) { /* 诊断失败不能影响主流程 */ }
}

export function diagObject(label, value) {
  try { diag(label + ' ' + JSON.stringify(value)) }
  catch (e) { diag(label + ' <unserializable>') }
}
