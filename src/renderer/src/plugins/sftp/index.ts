import { definePlugin } from '../types'
import SftpPanel from './SftpPanel'

export default definePlugin({
  id: 'sftp',
  name: '文件传输',
  version: '1.0.1',
  description: '基于 SFTP 的高性能文件上传 / 下载(主进程并行传输,带实时进度)',
  author: 'MySSH',
  category: 'files',
  official: true,
  builtin: true,
  defaultEnabled: true,
  panel: {
    title: '文件',
    Component: SftpPanel
  }
})
