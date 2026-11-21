const STUB_URL = new URL('./katex-stub.mjs', import.meta.url).href

/** 把所有 katex 导入指到测试替身（详见 katex-stub.mjs 头注释） */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'katex') {
    return { url: STUB_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
