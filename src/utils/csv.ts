/** CSV 单元格转义。会话标题等字段完全由用户/归档提供，需阻断表格软件的公式解析。 */
export const csvCell = (value: string | number): string => {
  let text = String(value)
  // = + - @ 与制表/回车是 Excel/WPS 的公式触发前缀；数值列直接传 number，不受影响
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
