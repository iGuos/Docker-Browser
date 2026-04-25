/** 从 docker inspect 结果取 Config.Image（可能含 registry/标签） */
export function imageRefFromInspect(ins: unknown): string {
  if (!ins || typeof ins !== 'object') return ''
  const cfg = (ins as Record<string, unknown>).Config as Record<string, unknown> | undefined
  const img = cfg?.Image
  return typeof img === 'string' ? img.trim() : ''
}

export type ImageSuggestion = {
  /** 稳定键，用于 option key */
  id: string
  command: string
}

export type ImageMatchedHints = {
  kind: string
  suggestions: ImageSuggestion[]
}

type Rule = { kind: string; test: (imageLower: string) => boolean; suggestions: ImageSuggestion[] }

const CH: ImageSuggestion[] = [
  { id: 'select1', command: 'clickhouse-client --query "SELECT 1"' },
  { id: 'interactive', command: 'clickhouse-client' },
  { id: 'show_dbs', command: 'clickhouse-client --query "SHOW DATABASES"' },
  { id: 'uptime', command: 'clickhouse-client --query "SELECT version()"' },
]

/** MySQL / MariaDB：连接、刷新权限、root@'%'、改当前登录用户密码（把 新密码 换成实际值；偏 MySQL 8 / MariaDB 10.4+） */
const MYSQL_FAMILY: ImageSuggestion[] = [
  { id: 'connect', command: 'mysql -uroot -p' },
  {
    id: 'root_host_pct',
    command: `CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'newpassword'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;`,
  },
  {
    id: 'change_root_password',
    command: `ALTER USER CURRENT_USER() IDENTIFIED BY 'newpassword';`,
  },
  { id: 'flush_privileges', command: 'FLUSH PRIVILEGES;' }
]

const PG: ImageSuggestion[] = [
  { id: 'psql', command: 'psql -U postgres' },
  { id: 'list_db', command: 'psql -U postgres -c "\\l"' },
  { id: 'ready', command: 'pg_isready -U postgres 2>/dev/null || pg_isready 2>/dev/null' },
  { id: 'version', command: 'psql -U postgres -c "SELECT version();"' },
]

const MONGO: ImageSuggestion[] = [
  { id: 'mongosh', command: 'mongosh' },
  { id: 'db_version', command: 'mongosh --eval "db.version()"' },
  { id: 'list_dbs', command: 'mongosh --eval "db.adminCommand({ listDatabases: 1 })"' },
]

const REDIS: ImageSuggestion[] = [
  { id: 'cli', command: 'redis-cli' },
  { id: 'ping', command: 'redis-cli PING' },
  { id: 'info', command: 'redis-cli INFO server 2>/dev/null | head -n 24' },
  { id: 'dbsize', command: 'redis-cli DBSIZE' },
]

const NGINX: ImageSuggestion[] = [
  { id: 'test', command: 'nginx -t' },
  { id: 'version', command: 'nginx -V 2>&1 | head -n 1' },
  { id: 'reload_dry', command: 'nginx -t && echo "config OK"' },
]

const HTTPD: ImageSuggestion[] = [
  { id: 'config_test', command: 'apachectl -t 2>/dev/null || httpd -t' },
  { id: 'version', command: 'apachectl -v 2>/dev/null || httpd -v 2>/dev/null' },
  { id: 'modules', command: 'apachectl -M 2>/dev/null | head -n 20 || httpd -M 2>/dev/null | head -n 20' },
]

const RMQ: ImageSuggestion[] = [
  { id: 'ping', command: 'rabbitmq-diagnostics -q ping' },
  { id: 'status', command: 'rabbitmqctl status 2>/dev/null | head -n 40' },
  { id: 'list_queues', command: 'rabbitmqctl list_queues name messages 2>/dev/null | head -n 30' },
]

const ES: ImageSuggestion[] = [
  { id: 'root', command: 'curl -sS localhost:9200' },
  { id: 'health', command: 'curl -sS "localhost:9200/_cluster/health?pretty"' },
  { id: 'nodes', command: 'curl -sS "localhost:9200/_cat/nodes?v"' },
]

const TRAEFIK: ImageSuggestion[] = [
  { id: 'version', command: 'traefik version' },
  { id: 'ping', command: 'wget -qO- http://127.0.0.1:8080/ping 2>/dev/null || curl -sS http://127.0.0.1:8080/ping 2>/dev/null || echo "no :8080/ping"' },
  { id: 'api_raw', command: 'curl -sS http://127.0.0.1:8080/api/rawdata 2>/dev/null | head -c 400 || echo "no rawdata"' },
]

const MINIO: ImageSuggestion[] = [
  { id: 'version', command: 'mc --version 2>/dev/null || minio --version' },
  { id: 'health', command: 'curl -sS -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:9000/minio/health/live 2>/dev/null || echo "adjust port/path"' },
]

const KAFKA: ImageSuggestion[] = [
  {
    id: 'topics',
    command:
      'kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/dev/null || kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null | head',
  },
  {
    id: 'versions',
    command:
      'kafka-broker-api-versions.sh --bootstrap-server localhost:9092 2>/dev/null | head -n 5 || echo "adjust bootstrap server"',
  },
  { id: 'bin_ls', command: 'ls /opt/kafka/bin 2>/dev/null | head || ls /usr/bin/kafka* 2>/dev/null | head' },
]

const ZK: ImageSuggestion[] = [
  { id: 'ruok', command: 'echo ruok | nc 127.0.0.1 2181 2>/dev/null || echo "nc failed"' },
  { id: 'status', command: 'zkServer.sh status 2>/dev/null || echo "zkServer.sh not in PATH"' },
]

const PY: ImageSuggestion[] = [
  { id: 'version', command: 'python3 -V' },
  { id: 'which', command: 'python3 -c "import sys; print(sys.executable)"' },
  { id: 'pip_head', command: 'pip list 2>/dev/null | head -n 15 || pip3 list 2>/dev/null | head -n 15' },
]

const NODE: ImageSuggestion[] = [
  { id: 'node_v', command: 'node -v' },
  { id: 'npm_v', command: 'npm -v 2>/dev/null || echo "no npm"' },
  { id: 'versions', command: 'node -e "console.log(process.versions)"' },
]

const JAVA: ImageSuggestion[] = [
  { id: 'version', command: 'java -version' },
  { id: 'jcmd', command: 'jcmd 2>/dev/null | head -n 10 || echo "jcmd unavailable"' },
]

const GO: ImageSuggestion[] = [
  { id: 'version', command: 'go version' },
  { id: 'env', command: 'go env GOROOT GOPATH' },
]

/**
 * 按镜像名（小写）匹配一组常用 shell 指令；顺序靠前者优先（更具体）。
 */
const RULES: Rule[] = [
  { kind: 'clickhouse', test: (s) => s.includes('clickhouse'), suggestions: CH },
  { kind: 'mariadb', test: (s) => s.includes('mariadb'), suggestions: MYSQL_FAMILY },
  {
    kind: 'mysql',
    test: (s) => /(^|[\/@])mysql(:|@|$)/i.test(s) || /\bmysql\b/i.test(s),
    suggestions: MYSQL_FAMILY,
  },
  {
    kind: 'postgres',
    test: (s) =>
      s.includes('postgres') ||
      s.includes('postgis') ||
      s.includes('timescale') ||
      s.includes('pgvector'),
    suggestions: PG,
  },
  { kind: 'mongo', test: (s) => s.includes('mongo'), suggestions: MONGO },
  { kind: 'redis', test: (s) => /redis(?!earch)/i.test(s), suggestions: REDIS },
  { kind: 'nginx', test: (s) => s.includes('nginx'), suggestions: NGINX },
  { kind: 'httpd', test: (s) => s.includes('httpd') || s.includes('apache'), suggestions: HTTPD },
  { kind: 'rabbitmq', test: (s) => s.includes('rabbitmq'), suggestions: RMQ },
  { kind: 'elasticsearch', test: (s) => s.includes('elasticsearch'), suggestions: ES },
  { kind: 'traefik', test: (s) => s.includes('traefik'), suggestions: TRAEFIK },
  { kind: 'minio', test: (s) => s.includes('minio'), suggestions: MINIO },
  { kind: 'kafka', test: (s) => /kafka|confluentinc\/cp-kafka|bitnami\/kafka/i.test(s), suggestions: KAFKA },
  { kind: 'zookeeper', test: (s) => s.includes('zookeeper'), suggestions: ZK },
  { kind: 'python', test: (s) => /python(:|@|$)/i.test(s) || s.includes('/python'), suggestions: PY },
  { kind: 'node', test: (s) => /(^|[\/@])node(:|@|\/)/i.test(s) || s.includes('node:'), suggestions: NODE },
  {
    kind: 'java',
    test: (s) =>
      s.includes('openjdk') ||
      s.includes('eclipse-temurin') ||
      s.includes('amazoncorretto') ||
      s.includes('/java:'),
    suggestions: JAVA,
  },
  { kind: 'go', test: (s) => /golang|^go(:|@)/i.test(s) || s.includes('/go:'), suggestions: GO },
]

export function matchImageHints(imageRef: string): ImageMatchedHints | null {
  const s = imageRef.trim().toLowerCase()
  if (!s) return null
  for (const r of RULES) {
    if (r.test(s)) return { kind: r.kind, suggestions: r.suggestions }
  }
  return null
}
