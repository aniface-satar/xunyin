import { httpGet } from '@/utils/request'
import { name } from '../../package.json'
import { downloadFile, stopDownload, temporaryDirectoryPath } from '@/utils/fs'
import { getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'

const abis = [
  'arm64-v8a',
  'armeabi-v7a',
  'x86_64',
  'x86',
  'universal',
]

const repository = 'aniface-satar/xunyin'

const address = [
  [`https://cdn.jsdmirror.cn/gh/${repository}@main/publish/version.json`, 'direct'],
  [`https://cdn.jsdmirror.com/gh/${repository}@main/publish/version.json`, 'direct'],
  [`https://cdn.jsdelivr.net/gh/${repository}@main/publish/version.json`, 'direct'],
  [`https://fastly.jsdelivr.net/gh/${repository}@main/publish/version.json`, 'direct'],
  [`https://ghproxy.net/https://raw.githubusercontent.com/${repository}/main/publish/version.json`, 'direct'],
  [`https://raw.githubusercontent.com/${repository}/main/publish/version.json`, 'direct'],
]


const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getDirectInfo = async(url) => {
  return request(url).then(info => {
    if (info.version == null) throw new Error('failed')
    return info
  })
}

const getNpmPkgInfo = async(url) => {
  return request(url).then(json => {
    if (!json.versionInfo) throw new Error('failed')
    const info = JSON.parse(json.versionInfo)
    if (info.version == null) throw new Error('failed')
    return info
  })
}

export const getVersionInfo = async(index = 0) => {
  const [url, source] = address[index]
  let promise
  switch (source) {
    case 'direct':
      promise = getDirectInfo(url)
      break
    case 'npm':
      promise = getNpmPkgInfo(url)
      break
  }

  return promise.catch(async(err) => {
    index++
    if (index >= address.length) throw err
    return getVersionInfo(index)
  })
}

const getTargetAbi = async() => {
  const supportedAbis = await getSupportedAbis()
  for (const abi of abis) {
    if (supportedAbis.includes(abi)) return abi
  }
  return abis[abis.length - 1]
}
const getDownloadUrls = async(version) => {
  const abi = await getTargetAbi()
  const filePath = `${repository}/releases/download/v${version}/${name}-v${version}-${abi}.apk`
  return [
    `https://ghproxy.net/https://github.com/${filePath}`,
    `https://ghfast.top/https://github.com/${filePath}`,
    `https://gh-proxy.com/https://github.com/${filePath}`,
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
