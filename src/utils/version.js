import { httpGet } from '@/utils/request'
import { name } from '../../package.json'
import { downloadFile, stopDownload, temporaryDirectoryPath } from '@/utils/fs'
import { getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import { compareVer } from '@/utils'

const abis = [
  'arm64-v8a',
  'armeabi-v7a',
  'x86_64',
  'x86',
  'universal',
]

const repository = 'aniface-satar/xunyin'
const giteeRepository = 'not-a-chanci/xunyin'

const getVersionInfoUrls = () => [
  `https://aniface-satar.github.io/xunyin/version.json?t=${Date.now()}`,
  `https://gitee.com/${giteeRepository}/raw/main/publish/version.json?t=${Date.now()}`,
  `https://cdn.jsdmirror.cn/gh/${repository}@main/publish/version.json`,
  `https://cdn.jsdmirror.com/gh/${repository}@main/publish/version.json`,
  `https://cdn.jsdelivr.net/gh/${repository}@main/publish/version.json`,
  `https://fastly.jsdelivr.net/gh/${repository}@main/publish/version.json`,
  `https://ghproxy.net/https://raw.githubusercontent.com/${repository}/main/publish/version.json`,
  `https://raw.githubusercontent.com/${repository}/main/publish/version.json`,
]


const request = async(url) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 5000,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        reject(err || new Error(resp.statusMessage || resp.statusCode))
      } else resolve(body)
    })
  })
}

let remoteInfo = null

const parseInfo = info => {
  if (!info || typeof info.version != 'string' || !info.version) throw new Error('failed')
  return {
    version: info.version,
    desc: typeof info.desc == 'string' ? info.desc : '',
    history: Array.isArray(info.history) ? info.history : [],
    downloadUrls: info.downloadUrls,
  }
}

export const getVersionInfo = async() => {
  const results = await Promise.allSettled(getVersionInfoUrls().map(async url => {
    return parseInfo(await request(url))
  }))
  const infos = results.flatMap(result => result.status == 'fulfilled' ? [result.value] : [])
  if (!infos.length) {
    throw results[0].status == 'rejected' ? results[0].reason : new Error('failed')
  }

  // A CDN may briefly return stale data; prefer the newest manifest across sources.
  const info = infos.reduce((latest, item) => compareVer(item.version, latest.version) > 0 ? item : latest)
  remoteInfo = info
  return info
}

const getTargetAbi = async() => {
  const supportedAbis = await getSupportedAbis()
  for (const abi of abis) {
    if (supportedAbis.includes(abi)) return abi
  }
  return abis[abis.length - 1]
}

const getCustomDownloadUrls = async(version) => {
  const info = remoteInfo?.version == version ? remoteInfo : await getVersionInfo().catch(() => null)
  const urls = info?.downloadUrls
  if (!urls) return []

  const abi = await getTargetAbi()
  const customUrls = Array.isArray(urls)
    ? urls
    : [urls[abi], urls.universal].flat()
  return customUrls.filter(url => typeof url == 'string' && url.startsWith('https://'))
}

const getDownloadUrls = async(version) => {
  const abi = await getTargetAbi()
  const filePath = `${repository}/releases/download/v${version}/${name}-v${version}-${abi}.apk`
  const customUrls = await getCustomDownloadUrls(version)
  return [
    ...customUrls,
    `https://ghproxy.net/https://github.com/${filePath}`,
    `https://ghfast.top/https://github.com/${filePath}`,
    `https://gh-proxy.com/https://github.com/${filePath}`,
    `https://gitee.com/${giteeRepository}/releases/download/v${version}/${name}-v${version}-${abi}.apk`,
    `https://github.com/${filePath}`,
  ]
}

export const getBrowserDownloadUrl = async(version) => (await getDownloadUrls(version))[0]

let downloadJobId = null
const noop = (total, download) => {}
let apkSavePath

export const downloadNewVersion = async(version, onDownload = noop) => {
  const urls = await getDownloadUrls(version)
  let savePath = temporaryDirectoryPath + '/lx-music-mobile.apk'

  const download = async(index) => {
    if (downloadJobId) stopDownload(downloadJobId)

    const { jobId, promise } = downloadFile(urls[index], savePath, {
      progressInterval: 500,
      connectionTimeout: 20000,
      readTimeout: 30000,
      begin({ contentLength }) {
        onDownload(contentLength, 0)
      },
      progress({ contentLength, bytesWritten }) {
        onDownload(contentLength, bytesWritten)
      },
    })
    downloadJobId = jobId

    return promise.catch(err => {
      if (index >= urls.length - 1) throw err
      return download(index + 1)
    })
  }

  await download(0)

  apkSavePath = savePath
  return updateApp()
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
