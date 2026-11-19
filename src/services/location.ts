import { regionCodes, regionNameOverrides } from './regionCodes.js'

export { regionCodes } from './regionCodes.js'

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

/** 省份选项：名称与下属城市列表，来自动态加载的 locationData 大表 */
export type ProvinceOption = {
  code: string
  name: string
  cities: { code: string; name: string }[]
}

const regions = new Set(regionCodes)
const regionNames = {
  'zh-CN': new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
  'en-US': new Intl.DisplayNames(['en-US'], { type: 'region' }),
}

export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string =>
  regions.has(code)
    ? (regionNameOverrides[locale][code] ?? regionNames[locale].of(code) ?? code)
    : ''

/** 省市大表只在需要时加载；结果缓存，多次调用共享同一次 import */
let provincesPromise: Promise<ProvinceOption[]> | null = null
export const loadProvinces = (): Promise<ProvinceOption[]> => {
  provincesPromise ??= import('./locationData.js').then(({ cityNames, provinceNames }) =>
    Object.entries(provinceNames).map(([code, name]) => ({
      code,
      name,
      cities: Object.entries(cityNames)
        .filter(([city]) => city.startsWith(code.slice(0, 2)))
        .map(([code, name]) => ({ code, name })),
    }))
  )
  return provincesPromise
}

/**
 * 只做结构校验，不查省市大表（保持同步）：region 必须是已知地区码，
 * CN 的省市码为 6 位数字，city 必须搭配 province。用于初始读取；完整校验见 normalizeLocation。
 */
export const parseLocationShape = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  if (typeof province !== 'string' || !/^\d{6}$/.test(province)) {
    return null
  }
  if (city === undefined) {
    return { region, province }
  }
  if (typeof city !== 'string' || !/^\d{6}$/.test(city)) {
    return null
  }
  return { region, province, city }
}

/** 完整校验：在结构校验之上再查省市大表，确认省市码真实存在。 */
export const normalizeLocation = async (value: unknown): Promise<UserLocation | null> => {
  const location = parseLocationShape(value)
  if (!location || location.region !== 'CN' || location.province === undefined) {
    return location
  }
  const options = await loadProvinces()
  const selectedProvince = options.find((item) => item.code === location.province)
  if (!selectedProvince) {
    return null
  }
  if (location.city === undefined) {
    return { region: location.region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === location.city)
  return selectedCity
    ? { region: location.region, province: selectedProvince.code, city: selectedCity.code }
    : null
}
