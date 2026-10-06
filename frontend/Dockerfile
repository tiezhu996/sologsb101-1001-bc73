# ---------- 构建阶段：安装依赖并产出静态产物 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 内网/镜像加速：默认走 npmmirror，可用 --build-arg NPM_REGISTRY=... 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "$NPM_REGISTRY"

# 先复制依赖清单，充分利用镜像层缓存
COPY package.json package-lock.json* ./

# 有 lock 文件用 npm ci 保证可复现，否则回退 npm install
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# 复制配置与源码，执行类型检查 + 生产构建（零错误）
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---------- 运行阶段：nginx 托管静态产物 ----------
FROM nginx:alpine AS runner

# 自定义 nginx 配置：SPA fallback + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 覆盖默认站点产物
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

# 兜底修正静态产物权限：宿主源码若为 0600（例如 public/favicon.svg），
# COPY 会原样保留权限，nginx worker 以 nginx 用户运行将读不到文件并返回 403
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
