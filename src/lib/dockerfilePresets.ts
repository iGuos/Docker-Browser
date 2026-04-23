/**
 * Dockerfile 参考模板：供创建弹窗「可搜索下拉」使用。
 */
import { filterSnippetPresets, getSnippetTitle, type SnippetPreset } from '@/lib/snippetPresetFilter'

export type DockerfilePreset = SnippetPreset

export const DOCKERFILE_PRESETS: DockerfilePreset[] = [
  {
    id: 'df-nginx-static',
    titleZh: 'Nginx 托管静态文件',
    titleEn: 'Nginx static files',
    keywords: 'nginx static html 前端',
    code: 'FROM nginx:alpine\nCOPY ./html /usr/share/nginx/html\nEXPOSE 80\n',
  },
  {
    id: 'df-node-nginx',
    titleZh: 'Node 构建 + Nginx 多阶段',
    titleEn: 'Node build + Nginx multi-stage',
    keywords: 'node npm vite react vue 前端 build',
    code: 'FROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=builder /app/dist /usr/share/nginx/html\nEXPOSE 80\n',
  },
  {
    id: 'df-python-slim',
    titleZh: 'Python 3.12（slim）',
    titleEn: 'Python 3.12 (slim)',
    keywords: 'python pip flask fastapi django',
    code: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt ./\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["python", "-m", "http.server", "8000"]\n',
  },
  {
    id: 'df-go-scratch',
    titleZh: 'Go 静态编译 + scratch',
    titleEn: 'Go static + scratch',
    keywords: 'go golang 编译 最小镜像',
    code: 'FROM golang:1.22-alpine AS build\nWORKDIR /src\nCOPY . .\nRUN CGO_ENABLED=0 go build -o /app\n\nFROM scratch\nCOPY --from=build /app /app\nENTRYPOINT ["/app"]\n',
  },
  {
    id: 'df-alpine-shell',
    titleZh: 'Alpine 交互调试',
    titleEn: 'Alpine shell debug',
    keywords: 'alpine sh 调试 busybox',
    code: 'FROM alpine:3.19\nRUN apk add --no-cache curl bind-tools\nWORKDIR /work\nCMD ["sh"]\n',
  },
]

export function filterDockerfilePresets(query: string, lang: string): DockerfilePreset[] {
  return filterSnippetPresets(DOCKERFILE_PRESETS, query, lang)
}

export { getSnippetTitle as getDockerfilePresetTitle }
