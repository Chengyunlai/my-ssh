/**
 * 端口发现的合成夹具 —— 供 shared 层单测与 main 层端到端测试共用。
 *
 * 全部是手写数据，**不含任何真实主机信息**（不出现真实 IP、主机名或私钥）。
 *
 * 拓扑是精心选的：**16 条监听记录 → 12 个服务 → 8 个可访问服务 → 4 个应用**，
 * 一条链上覆盖四类噪声，缺任何一类都测不出收敛是否真的做了：
 *   - 双栈重复：22/80/443 各有 v4 与 v6 两条绑定，必须并成一条服务
 *   - 系统后台套接字：systemd-resolved ×2、systemd-networkd、chronyd ×2
 *   - 一 socket 多持有者：nginx 是 1 master + 2 worker；22 号口是 systemd + sshd（socket 激活）
 *   - 同一容器多端口：一个容器对外开了 4 个宿主端口，那是 1 个应用不是 4 个
 */
export const SS_OUTPUT = [
  'MYSSH_NETLIST_V1',
  '[meta]',
  'uid=1000',
  'sudo=1',
  'ssver=ss utility, iproute2-6.1.0',
  '[tcplisten]',
  // socket 激活：systemd 持有 fd，但它不是服务本身
  'LISTEN 0      128          0.0.0.0:22           0.0.0.0:*      users:(("systemd",pid=1,fd=45),("sshd",pid=812,fd=3))',
  'LISTEN 0      128             [::]:22              [::]:*      users:(("sshd",pid=812,fd=4))',
  // 长行不补尾空格、短行补 —— 两者混在一起
  'LISTEN 0      511          0.0.0.0:80           0.0.0.0:*      users:(("nginx",pid=1201,fd=6),("nginx",pid=1202,fd=6),("nginx",pid=1203,fd=6))',
  'LISTEN 0      511             [::]:80              [::]:*      users:(("nginx",pid=1201,fd=7))',
  'LISTEN 0      511          0.0.0.0:443          0.0.0.0:*      users:(("nginx",pid=1201,fd=8))',
  'LISTEN 0      511             [::]:443            [::]:*      users:(("nginx",pid=1201,fd=9))',
  'LISTEN 0      4096       127.0.0.1:8080         0.0.0.0:*      users:(("docker-proxy",pid=2101,fd=4))',
  'LISTEN 0      4096       127.0.0.1:8443         0.0.0.0:*      users:(("docker-proxy",pid=2102,fd=4))',
  'LISTEN 0      4096       127.0.0.1:30001        0.0.0.0:*      users:(("docker-proxy",pid=2103,fd=4))',
  'LISTEN 0      4096       127.0.0.1:30002        0.0.0.0:*      users:(("docker-proxy",pid=2104,fd=4))',
  'LISTEN 0      128        127.0.0.1:8099         0.0.0.0:*      users:(("python3",pid=3201,fd=3))',
  'LISTEN 0      4096     127.0.0.53%lo:53         0.0.0.0:*      users:(("systemd-resolve",pid=701,fd=13))',
  '[udplisten]',
  'UNCONN 0      0      127.0.0.54%lo:53         0.0.0.0:*      users:(("systemd-resolve",pid=701,fd=14))',
  'UNCONN 0      0       10.0.0.12%eth0:68       0.0.0.0:*      users:(("systemd-network",pid=702,fd=20))',
  'UNCONN 0      0       127.0.0.1:323           0.0.0.0:*      users:(("chronyd",pid=801,fd=5))',
  'UNCONN 0      0           [::1]:323              [::]:*      users:(("chronyd",pid=801,fd=6))',
  '[containers]',
  'panel\tportainer/portainer-ce:2.19.4\t127.0.0.1:8080->80/tcp, 127.0.0.1:8443->443/tcp, 127.0.0.1:30001-30002->30001-30002/tcp',
  '[osrelease]',
  'PRETTY_NAME="Ubuntu 24.04.4 LTS"',
  'VERSION_ID="24.04"',
  'ID=ubuntu',
  '[identity]',
  '1000',
  'END'
].join('\n')

/** 上面那份输出的期望收敛结果，测试与文档共用同一组数字 */
export const SS_EXPECTED = {
  sockets: 16,
  services: 12,
  accessibleServices: 8,
  systemSockets: 4,
  applications: 4,
  apps: ['Portainer', 'nginx', 'OpenSSH', 'Python 服务']
} as const

/** `/proc/net/*` 形态输出的头部（远端没有 ss 时的退化路径） */
export const PROC_HEADER = ['MYSSH_NETLIST_V1', '[meta]', 'uid=1000', 'sudo=0', 'ssver=none', '[tcplisten]']

/**
 * /proc 的行：`0100007F:1F90` = 127.0.0.1:8080，`00000000:0050` = 0.0.0.0:80。
 * 这一节连表头一起给，因为真实输出一定带表头。
 */
export const PROC_ROWS = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 1',
  '   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0 0 2'
]
