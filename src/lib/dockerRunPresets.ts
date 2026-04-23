/**
 * docker run 常用工具：按工具 id ASCII 升序；每工具多版本，版本下拉为 latest 置顶，其余按 sortKey 降序。
 */

export type DockerRunToolVersion = {
  /** 下拉展示与匹配，如 latest、8.0、16-alpine */
  versionId: string
  /** 非 latest 版本用于降序排列，越大越新 */
  sortKey: number
  code: string
}

export type DockerRunTool = {
  /** 用于 ASCII 排序的 id（小写英文） */
  id: string
  titleZh: string
  titleEn: string
  versions: DockerRunToolVersion[]
}

export function getDockerRunToolTitle(tool: DockerRunTool, lang: string): string {
  return (lang ?? '').toLowerCase().startsWith('zh') ? tool.titleZh : tool.titleEn
}

export function sortToolsAsciiAsc(tools: readonly DockerRunTool[]): DockerRunTool[] {
  return [...tools].sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

/** latest 置顶，其余按 sortKey 降序 */
export function orderVersionsForUi(versions: readonly DockerRunToolVersion[]): DockerRunToolVersion[] {
  const latest = versions.filter((v) => v.versionId === 'latest')
  const rest = versions.filter((v) => v.versionId !== 'latest').sort((a, b) => b.sortKey - a.sortKey)
  return [...latest, ...rest]
}

export function defaultVersionIdForTool(versions: readonly DockerRunToolVersion[]): string {
  return orderVersionsForUi(versions)[0]?.versionId ?? 'latest'
}

export function findDockerRunTool(tools: readonly DockerRunTool[], toolId: string): DockerRunTool | undefined {
  return tools.find((t) => t.id === toolId)
}

export function resolveDockerRunCode(
  tools: readonly DockerRunTool[],
  toolId: string,
  versionId: string,
): string | null {
  const t = findDockerRunTool(tools, toolId)
  const v = t?.versions.find((x) => x.versionId === versionId)
  return v?.code ?? null
}

function tokenMatchesRunToolHaystack(haystack: string, token: string): boolean {
  if (!token) return true
  if (haystack.includes(token)) return true
  let from = 0
  for (const ch of token) {
    const i = haystack.indexOf(ch, from)
    if (i === -1) return false
    from = i + 1
  }
  return true
}

/** 按 id、中英文标题模糊筛选（空格分词、子序列匹配；中英文标题均参与匹配） */
export function filterDockerRunTools(
  tools: readonly DockerRunTool[],
  query: string,
  _lang: string,
): DockerRunTool[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return [...tools]
  const tokens = raw.split(/\s+/).filter(Boolean)
  return tools.filter((t) => {
    const haystack = `${t.titleZh.toLowerCase()} ${t.titleEn.toLowerCase()} ${t.id.toLowerCase()}`
    return tokens.every((tok) => tokenMatchesRunToolHaystack(haystack, tok))
  })
}

const pw = 'changeme'
const pw12 = 'changeme12'

export const DOCKER_RUN_TOOLS: DockerRunTool[] = [
  {
    id: 'adminer',
    titleZh: 'Adminer',
    titleEn: 'Adminer',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name adminer -p 8081:8080 adminer:latest` },
      { versionId: '4', sortKey: 40000, code: `docker run -d --name adminer -p 8081:8080 adminer:4` },
    ],
  },
  {
    id: 'consul',
    titleZh: 'Consul',
    titleEn: 'Consul',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name consul -p 8500:8500 hashicorp/consul:latest agent -dev -client=0.0.0.0 -ui`,
      },
      { versionId: '1.19', sortKey: 11900, code: `docker run -d --name consul -p 8500:8500 hashicorp/consul:1.19 agent -dev -client=0.0.0.0 -ui` },
      { versionId: '1.17', sortKey: 11700, code: `docker run -d --name consul -p 8500:8500 hashicorp/consul:1.17 agent -dev -client=0.0.0.0 -ui` },
    ],
  },
  {
    id: 'clickhouse',
    titleZh: 'ClickHouse',
    titleEn: 'ClickHouse',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name clickhouse -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:latest`,
      },
      {
        versionId: '24.3',
        sortKey: 240300,
        code: `docker run -d --name clickhouse -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:24.3`,
      },
      {
        versionId: '23.8',
        sortKey: 230800,
        code: `docker run -d --name clickhouse -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:23.8`,
      },
    ],
  },
  {
    id: 'etcd',
    titleZh: 'etcd',
    titleEn: 'etcd',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name etcd -p 2379:2379 -p 2380:2380 quay.io/coreos/etcd:v3.5.15 etcd --name s1 --data-dir /etcd-data --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://localhost:2379 --listen-peer-urls http://0.0.0.0:2380`,
      },
      {
        versionId: '3.5.15',
        sortKey: 30515,
        code: `docker run -d --name etcd -p 2379:2379 -p 2380:2380 quay.io/coreos/etcd:v3.5.15 etcd --name s1 --data-dir /etcd-data --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://localhost:2379 --listen-peer-urls http://0.0.0.0:2380`,
      },
    ],
  },
  {
    id: 'elasticsearch',
    titleZh: 'Elasticsearch',
    titleEn: 'Elasticsearch',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name es -e discovery.type=single-node -e "xpack.security.enabled=false" -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" -p 9200:9200 docker.elastic.co/elasticsearch/elasticsearch:latest`,
      },
      {
        versionId: '8.17',
        sortKey: 81700,
        code: `docker run -d --name es -e discovery.type=single-node -e "xpack.security.enabled=false" -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" -p 9200:9200 docker.elastic.co/elasticsearch/elasticsearch:8.17.4`,
      },
      {
        versionId: '8.11',
        sortKey: 81100,
        code: `docker run -d --name es -e discovery.type=single-node -e "xpack.security.enabled=false" -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" -p 9200:9200 docker.elastic.co/elasticsearch/elasticsearch:8.11.0`,
      },
    ],
  },
  {
    id: 'grafana',
    titleZh: 'Grafana',
    titleEn: 'Grafana',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name grafana -p 3000:3000 grafana/grafana:latest`,
      },
      { versionId: '11.2', sortKey: 110200, code: `docker run -d --name grafana -p 3000:3000 grafana/grafana:11.2.0` },
      { versionId: '10.4', sortKey: 100400, code: `docker run -d --name grafana -p 3000:3000 grafana/grafana:10.4.3` },
    ],
  },
  {
    id: 'golang',
    titleZh: 'Go',
    titleEn: 'Go',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name golang-dev --restart unless-stopped -v golang-dev-workspace:/src -w /src golang:latest tail -f /dev/null`,
      },
      {
        versionId: '1.23',
        sortKey: 12300,
        code: `docker run -d --name golang-dev --restart unless-stopped -v golang-dev-workspace:/src -w /src golang:1.23-alpine tail -f /dev/null`,
      },
      {
        versionId: '1.22',
        sortKey: 12200,
        code: `docker run -d --name golang-dev --restart unless-stopped -v golang-dev-workspace:/src -w /src golang:1.22-alpine tail -f /dev/null`,
      },
      {
        versionId: '1.21',
        sortKey: 12100,
        code: `docker run -d --name golang-dev --restart unless-stopped -v golang-dev-workspace:/src -w /src golang:1.21-alpine tail -f /dev/null`,
      },
    ],
  },
  {
    id: 'httpd',
    titleZh: 'Apache httpd',
    titleEn: 'Apache httpd',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name httpd -p 8082:80 httpd:latest` },
      { versionId: '2.4', sortKey: 24000, code: `docker run -d --name httpd -p 8082:80 httpd:2.4-alpine` },
    ],
  },
  {
    id: 'jenkins',
    titleZh: 'Jenkins',
    titleEn: 'Jenkins',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name jenkins -p 8080:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts-jdk21`,
      },
      {
        versionId: 'lts-jdk17',
        sortKey: 21721,
        code: `docker run -d --name jenkins -p 8080:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts-jdk17`,
      },
      {
        versionId: '2.479-lts',
        sortKey: 24790,
        code: `docker run -d --name jenkins -p 8080:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home jenkins/jenkins:2.479.3-lts-jdk21`,
      },
    ],
  },
  {
    id: 'jaeger',
    titleZh: 'Jaeger',
    titleEn: 'Jaeger',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name jaeger -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest`,
      },
      {
        versionId: '1.62',
        sortKey: 16200,
        code: `docker run -d --name jaeger -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:1.62`,
      },
    ],
  },
  {
    id: 'localstack',
    titleZh: 'LocalStack',
    titleEn: 'LocalStack',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name localstack -p 4566:4566 localstack/localstack:latest` },
      { versionId: '3.8', sortKey: 30800, code: `docker run -d --name localstack -p 4566:4566 localstack/localstack:3.8` },
      { versionId: '3.5', sortKey: 30500, code: `docker run -d --name localstack -p 4566:4566 localstack/localstack:3.5` },
    ],
  },
  {
    id: 'kafka',
    titleZh: 'Apache Kafka (KRaft)',
    titleEn: 'Apache Kafka (KRaft)',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name kafka -p 9092:9092 apache/kafka:latest`,
      },
      {
        versionId: '3.8.0',
        sortKey: 30800,
        code: `docker run -d --name kafka -p 9092:9092 apache/kafka:3.8.0`,
      },
      {
        versionId: '3.7.0',
        sortKey: 30700,
        code: `docker run -d --name kafka -p 9092:9092 apache/kafka:3.7.0`,
      },
    ],
  },
  {
    id: 'mailhog',
    titleZh: 'MailHog',
    titleEn: 'MailHog',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog:latest` },
    ],
  },
  {
    id: 'mariadb',
    titleZh: 'MariaDB',
    titleEn: 'MariaDB',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name mariadb -e MARIADB_ROOT_PASSWORD=${pw} -p 3307:3306 mariadb:latest`,
      },
      { versionId: '11.4', sortKey: 110400, code: `docker run -d --name mariadb -e MARIADB_ROOT_PASSWORD=${pw} -p 3307:3306 mariadb:11.4` },
      { versionId: '11.2', sortKey: 110200, code: `docker run -d --name mariadb -e MARIADB_ROOT_PASSWORD=${pw} -p 3307:3306 mariadb:11.2` },
      { versionId: '10.11', sortKey: 100110, code: `docker run -d --name mariadb -e MARIADB_ROOT_PASSWORD=${pw} -p 3307:3306 mariadb:10.11` },
    ],
  },
  {
    id: 'memcached',
    titleZh: 'Memcached',
    titleEn: 'Memcached',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name memcache -p 11211:11211 memcached:latest` },
      { versionId: '1.6-alpine', sortKey: 16000, code: `docker run -d --name memcache -p 11211:11211 memcached:1.6-alpine` },
      { versionId: '1.5-alpine', sortKey: 15000, code: `docker run -d --name memcache -p 11211:11211 memcached:1.5-alpine` },
    ],
  },
  {
    id: 'minio',
    titleZh: 'MinIO',
    titleEn: 'MinIO',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=${pw12} -v minio_data:/data quay.io/minio/minio:latest server /data --console-address ":9001"`,
      },
      {
        versionId: 'RELEASE.2024',
        sortKey: 202412,
        code: `docker run -d --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=${pw12} -v minio_data:/data quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z server /data --console-address ":9001"`,
      },
    ],
  },
  {
    id: 'nacos',
    titleZh: 'Nacos',
    titleEn: 'Nacos',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name nacos -e MODE=standalone -p 8848:8848 -p 9848:9848 -p 9849:9849 nacos/nacos-server:latest`,
      },
      {
        versionId: '2.4.3',
        sortKey: 20403,
        code: `docker run -d --name nacos -e MODE=standalone -p 8848:8848 -p 9848:9848 -p 9849:9849 nacos/nacos-server:v2.4.3`,
      },
      {
        versionId: '2.3.2',
        sortKey: 20302,
        code: `docker run -d --name nacos -e MODE=standalone -p 8848:8848 -p 9848:9848 -p 9849:9849 nacos/nacos-server:v2.3.2`,
      },
    ],
  },
  {
    id: 'nexus',
    titleZh: 'Sonatype Nexus',
    titleEn: 'Sonatype Nexus',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name nexus -p 8081:8081 -e INSTALL4J_ADD_VM_PARAMS="-Xms512m -Xmx512m" -v nexus-data:/nexus-data sonatype/nexus3:latest`,
      },
      {
        versionId: '3.77',
        sortKey: 37700,
        code: `docker run -d --name nexus -p 8081:8081 -e INSTALL4J_ADD_VM_PARAMS="-Xms512m -Xmx512m" -v nexus-data:/nexus-data sonatype/nexus3:3.77.1`,
      },
      {
        versionId: '3.73',
        sortKey: 37300,
        code: `docker run -d --name nexus -p 8081:8081 -e INSTALL4J_ADD_VM_PARAMS="-Xms512m -Xmx512m" -v nexus-data:/nexus-data sonatype/nexus3:3.73.0`,
      },
    ],
  },
  {
    id: 'mongodb',
    titleZh: 'MongoDB',
    titleEn: 'MongoDB',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name mongo -p 27017:27017 mongo:latest` },
      { versionId: '7.0', sortKey: 70000, code: `docker run -d --name mongo -p 27017:27017 mongo:7.0` },
      { versionId: '6.0', sortKey: 60000, code: `docker run -d --name mongo -p 27017:27017 mongo:6.0` },
      { versionId: '5.0', sortKey: 50000, code: `docker run -d --name mongo -p 27017:27017 mongo:5.0` },
    ],
  },
  {
    id: 'mysql',
    titleZh: 'MySQL',
    titleEn: 'MySQL',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name mysql -e MYSQL_ROOT_PASSWORD=${pw} -p 3306:3306 mysql:latest`,
      },
      { versionId: '8.4', sortKey: 80400, code: `docker run -d --name mysql -e MYSQL_ROOT_PASSWORD=${pw} -p 3306:3306 mysql:8.4` },
      { versionId: '8.0', sortKey: 80000, code: `docker run -d --name mysql -e MYSQL_ROOT_PASSWORD=${pw} -p 3306:3306 mysql:8.0` },
      { versionId: '5.7', sortKey: 50700, code: `docker run -d --name mysql -e MYSQL_ROOT_PASSWORD=${pw} -p 3306:3306 mysql:5.7` },
    ],
  },
  {
    id: 'openjdk',
    titleZh: 'OpenJDK (Eclipse Temurin)',
    titleEn: 'OpenJDK (Eclipse Temurin)',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name openjdk-dev --restart unless-stopped -v openjdk-dev-workspace:/work -w /work eclipse-temurin:latest-jdk-alpine tail -f /dev/null`,
      },
      {
        versionId: '21-jdk',
        sortKey: 21000,
        code: `docker run -d --name openjdk-dev --restart unless-stopped -v openjdk-dev-workspace:/work -w /work eclipse-temurin:21-jdk-alpine tail -f /dev/null`,
      },
      {
        versionId: '17-jdk',
        sortKey: 17000,
        code: `docker run -d --name openjdk-dev --restart unless-stopped -v openjdk-dev-workspace:/work -w /work eclipse-temurin:17-jdk-alpine tail -f /dev/null`,
      },
      {
        versionId: '11-jdk',
        sortKey: 11000,
        code: `docker run -d --name openjdk-dev --restart unless-stopped -v openjdk-dev-workspace:/work -w /work eclipse-temurin:11-jdk-alpine tail -f /dev/null`,
      },
    ],
  },
  {
    id: 'nginx',
    titleZh: 'Nginx',
    titleEn: 'Nginx',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name nginx -p 8080:80 nginx:latest`,
      },
      {
        versionId: '1.27-alpine',
        sortKey: 12700,
        code: `docker run -d --name nginx -p 8080:80 nginx:1.27-alpine`,
      },
      {
        versionId: '1.25-alpine',
        sortKey: 12500,
        code: `docker run -d --name nginx -p 8080:80 nginx:1.25-alpine`,
      },
    ],
  },
  {
    id: 'node',
    titleZh: 'Node.js',
    titleEn: 'Node.js',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name node-dev --restart unless-stopped -v node-dev-workspace:/app -w /app node:latest-alpine tail -f /dev/null`,
      },
      {
        versionId: '22-alpine',
        sortKey: 22000,
        code: `docker run -d --name node-dev --restart unless-stopped -v node-dev-workspace:/app -w /app node:22-alpine tail -f /dev/null`,
      },
      {
        versionId: '20-alpine',
        sortKey: 20000,
        code: `docker run -d --name node-dev --restart unless-stopped -v node-dev-workspace:/app -w /app node:20-alpine tail -f /dev/null`,
      },
      {
        versionId: '18-alpine',
        sortKey: 18000,
        code: `docker run -d --name node-dev --restart unless-stopped -v node-dev-workspace:/app -w /app node:18-alpine tail -f /dev/null`,
      },
    ],
  },
  {
    id: 'prometheus',
    titleZh: 'Prometheus',
    titleEn: 'Prometheus',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name prometheus -p 9090:9090 prom/prometheus:latest`,
      },
      {
        versionId: '2.55',
        sortKey: 25500,
        code: `docker run -d --name prometheus -p 9090:9090 prom/prometheus:v2.55.1`,
      },
      {
        versionId: '2.53',
        sortKey: 25300,
        code: `docker run -d --name prometheus -p 9090:9090 prom/prometheus:v2.53.3`,
      },
    ],
  },
  {
    id: 'portainer',
    titleZh: 'Portainer CE',
    titleEn: 'Portainer CE',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d -p 9443:9443 --name portainer --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:latest`,
      },
      {
        versionId: '2.21.5',
        sortKey: 22105,
        code: `docker run -d -p 9443:9443 --name portainer --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:2.21.5`,
      },
    ],
  },
  {
    id: 'postgres',
    titleZh: 'PostgreSQL',
    titleEn: 'PostgreSQL',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name pg -e POSTGRES_PASSWORD=${pw} -e POSTGRES_USER=app -p 5432:5432 postgres:latest`,
      },
      {
        versionId: '16-alpine',
        sortKey: 160000,
        code: `docker run -d --name pg -e POSTGRES_PASSWORD=${pw} -e POSTGRES_USER=app -p 5432:5432 postgres:16-alpine`,
      },
      {
        versionId: '15-alpine',
        sortKey: 150000,
        code: `docker run -d --name pg -e POSTGRES_PASSWORD=${pw} -e POSTGRES_USER=app -p 5432:5432 postgres:15-alpine`,
      },
      {
        versionId: '14-alpine',
        sortKey: 140000,
        code: `docker run -d --name pg -e POSTGRES_PASSWORD=${pw} -e POSTGRES_USER=app -p 5432:5432 postgres:14-alpine`,
      },
    ],
  },
  {
    id: 'python',
    titleZh: 'Python',
    titleEn: 'Python',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name python-dev --restart unless-stopped -v python-dev-workspace:/app -w /app python:latest-slim tail -f /dev/null`,
      },
      {
        versionId: '3.12-slim',
        sortKey: 31200,
        code: `docker run -d --name python-dev --restart unless-stopped -v python-dev-workspace:/app -w /app python:3.12-slim tail -f /dev/null`,
      },
      {
        versionId: '3.11-slim',
        sortKey: 31100,
        code: `docker run -d --name python-dev --restart unless-stopped -v python-dev-workspace:/app -w /app python:3.11-slim tail -f /dev/null`,
      },
      {
        versionId: '3.10-slim',
        sortKey: 31000,
        code: `docker run -d --name python-dev --restart unless-stopped -v python-dev-workspace:/app -w /app python:3.10-slim tail -f /dev/null`,
      },
    ],
  },
  {
    id: 'rabbitmq',
    titleZh: 'RabbitMQ',
    titleEn: 'RabbitMQ',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:management`,
      },
      {
        versionId: '4-management',
        sortKey: 40000,
        code: `docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:4-management-alpine`,
      },
      {
        versionId: '3.13-management',
        sortKey: 31300,
        code: `docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3.13-management-alpine`,
      },
      {
        versionId: '3.12-management',
        sortKey: 31200,
        code: `docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3.12-management-alpine`,
      },
    ],
  },
  {
    id: 'redis',
    titleZh: 'Redis',
    titleEn: 'Redis',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name redis -p 6379:6379 redis:latest` },
      { versionId: '7-alpine', sortKey: 70000, code: `docker run -d --name redis -p 6379:6379 redis:7-alpine` },
      { versionId: '6-alpine', sortKey: 60000, code: `docker run -d --name redis -p 6379:6379 redis:6-alpine` },
    ],
  },
  {
    id: 'registry',
    titleZh: 'Docker Registry',
    titleEn: 'Docker Registry',
    versions: [
      { versionId: 'latest', sortKey: 1e9, code: `docker run -d --name registry -p 5000:5000 registry:2` },
      { versionId: '2.8', sortKey: 20800, code: `docker run -d --name registry -p 5000:5000 registry:2.8.3` },
    ],
  },
  {
    id: 'redpanda',
    titleZh: 'Redpanda',
    titleEn: 'Redpanda',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name redpanda -p 9092:9092 -p 9644:9644 docker.redpanda.com/redpandadata/redpanda:latest redpanda start --mode dev-container`,
      },
      {
        versionId: '24.3',
        sortKey: 240300,
        code: `docker run -d --name redpanda -p 9092:9092 -p 9644:9644 docker.redpanda.com/redpandadata/redpanda:v24.3.1 redpanda start --mode dev-container`,
      },
    ],
  },
  {
    id: 'skywalking',
    titleZh: 'SkyWalking OAP',
    titleEn: 'SkyWalking OAP',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name skywalking-oap -p 11800:11800 -p 12800:12800 apache/skywalking-oap-server:latest`,
      },
      {
        versionId: '10.1',
        sortKey: 100100,
        code: `docker run -d --name skywalking-oap -p 11800:11800 -p 12800:12800 apache/skywalking-oap-server:10.1.0`,
      },
      {
        versionId: '9.7',
        sortKey: 97000,
        code: `docker run -d --name skywalking-oap -p 11800:11800 -p 12800:12800 -e SW_STORAGE=h2 apache/skywalking-oap-server:9.7.0`,
      },
    ],
  },
  {
    id: 'sonarqube',
    titleZh: 'SonarQube',
    titleEn: 'SonarQube',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name sonarqube -p 9000:9000 -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true sonarqube:community`,
      },
      {
        versionId: 'lts-community',
        sortKey: 99500,
        code: `docker run -d --name sonarqube -p 9000:9000 -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true sonarqube:lts-community`,
      },
      {
        versionId: '10.6-community',
        sortKey: 100600,
        code: `docker run -d --name sonarqube -p 9000:9000 -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true sonarqube:10.6-community`,
      },
    ],
  },
  {
    id: 'traefik',
    titleZh: 'Traefik',
    titleEn: 'Traefik',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name traefik -p 80:80 -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock traefik:latest --api.insecure=true --providers.docker=true`,
      },
      {
        versionId: '3.2',
        sortKey: 30200,
        code: `docker run -d --name traefik -p 80:80 -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock traefik:v3.2 --api.insecure=true --providers.docker=true`,
      },
      {
        versionId: '2.11',
        sortKey: 21100,
        code: `docker run -d --name traefik -p 80:80 -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock traefik:v2.11 --api.insecure=true --providers.docker=true`,
      },
    ],
  },
  {
    id: 'xxljob',
    titleZh: 'XXL-JOB Admin',
    titleEn: 'XXL-JOB Admin',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name xxl-job-admin -p 18080:8080 -e PARAMS="--spring.datasource.url=jdbc:mysql://host.docker.internal:3306/xxl_job?useUnicode=true&characterEncoding=UTF-8&autoReconnect=true&serverTimezone=Asia/Shanghai --spring.datasource.username=root --spring.datasource.password=${pw}" xuxueli/xxl-job-admin:latest`,
      },
      {
        versionId: '2.5.0',
        sortKey: 20500,
        code: `docker run -d --name xxl-job-admin -p 18080:8080 -e PARAMS="--spring.datasource.url=jdbc:mysql://host.docker.internal:3306/xxl_job?useUnicode=true&characterEncoding=UTF-8&autoReconnect=true&serverTimezone=Asia/Shanghai --spring.datasource.username=root --spring.datasource.password=${pw}" xuxueli/xxl-job-admin:2.5.0`,
      },
      {
        versionId: '2.4.1',
        sortKey: 20401,
        code: `docker run -d --name xxl-job-admin -p 18080:8080 -e PARAMS="--spring.datasource.url=jdbc:mysql://host.docker.internal:3306/xxl_job?useUnicode=true&characterEncoding=UTF-8&autoReconnect=true&serverTimezone=Asia/Shanghai --spring.datasource.username=root --spring.datasource.password=${pw}" xuxueli/xxl-job-admin:2.4.1`,
      },
    ],
  },
  {
    id: 'rust',
    titleZh: 'Rust',
    titleEn: 'Rust',
    versions: [
      {
        versionId: 'latest',
        sortKey: 1e9,
        code: `docker run -d --name rust-dev --restart unless-stopped -v rust-dev-workspace:/project -w /project rust:latest-alpine tail -f /dev/null`,
      },
      {
        versionId: '1.83',
        sortKey: 18300,
        code: `docker run -d --name rust-dev --restart unless-stopped -v rust-dev-workspace:/project -w /project rust:1.83-alpine tail -f /dev/null`,
      },
      {
        versionId: '1-alpine',
        sortKey: 15000,
        code: `docker run -d --name rust-dev --restart unless-stopped -v rust-dev-workspace:/project -w /project rust:1-alpine tail -f /dev/null`,
      },
    ],
  },
]
