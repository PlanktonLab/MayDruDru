# Build context is the repo root: this is an npm workspace, so the root manifests
# and every workspace package.json are needed before `npm ci` can run.
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/apply-web/package.json apps/apply-web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mask-editor/package.json packages/mask-editor/
COPY packages/ocr/package.json packages/ocr/
COPY packages/review-rules/package.json packages/review-rules/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY packages/ packages/
COPY apps/apply-web/ apps/apply-web/
RUN npm run build -w @maydru/apply-web

FROM nginx:1.27-alpine
COPY docker/nginx-apply.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/apply-web/dist /usr/share/nginx/html
EXPOSE 80
