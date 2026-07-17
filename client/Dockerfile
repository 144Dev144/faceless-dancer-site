FROM node:22-alpine AS build
WORKDIR /app/client
ARG VITE_SOLANA_NETWORK=devnet
ARG VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG VITE_FACELESS_PRICE_RPC_URL=https://solana-rpc.publicnode.com
ARG SECONDARY_RPC_NODE=
ENV VITE_SOLANA_NETWORK=${VITE_SOLANA_NETWORK}
ENV VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL}
ENV VITE_FACELESS_PRICE_RPC_URL=${VITE_FACELESS_PRICE_RPC_URL}
ENV SECONDARY_RPC_NODE=${SECONDARY_RPC_NODE}
COPY client/package.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
