import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvCell } from '../src/utils/csv.js'
import { safeFileName } from '../src/utils/fileName.js'

test('CSV 单元格阻断公式注入并保留正常转义', () => {
  assert.equal(csvCell('hello'), 'hello')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell('=CMD'), '\'=CMD')
  assert.equal(csvCell('+cmd'), '\'+cmd')
  assert.equal(csvCell('-cmd'), '\'-cmd')
  assert.equal(csvCell('@SUM'), '\'@SUM')
  // 同时含公式前缀与分隔符时，先加单引号再按 CSV 规则加双引号
  assert.equal(csvCell('=a,b'), '"\'=a,b"')
  // 数值列直接传 number，不能被误当成公式
  assert.equal(csvCell(-1), '-1')
  assert.equal(csvCell(0), '0')
})

test('下载文件名净化非法字符与控制字符', () => {
  assert.equal(safeFileName('report.md'), 'report.md')
  assert.equal(safeFileName('a/b\\c:d'), 'a_b_c_d')
  assert.equal(safeFileName('bad\r\nname'), 'bad_name')
  assert.equal(safeFileName('   '), 'file')
  assert.equal(safeFileName('..'), 'file')
  assert.equal(safeFileName('', 'image'), 'image')
})
