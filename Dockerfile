FROM node:22

# Define build arguments
ARG VERSION=dev
ARG BUILDTIME=unknown
ARG REVISION=unknown

# Set Docker labels
LABEL org.opencontainers.image.title="ATT&CK Workbench REST API Service" \
    org.opencontainers.image.description="This Docker image contains the REST API service of the ATT&CK Workbench, an application for exploring, creating, annotating, and sharing extensions of the MITRE ATT&CK® knowledge base. The service handles the storage, querying, and editing of ATT&CK objects. The application is built on Node.js and Express.js, and is served by the built-in web server provided by Express.js." \
    org.opencontainers.image.source="https://github.com/mitre-attack/attack-workbench-rest-api" \
    org.opencontainers.image.documentation="https://github.com/mitre-attack/attack-workbench-rest-api/README.md" \
    org.opencontainers.image.url="https://ghcr.io/center-for-threat-informed-defense/attack-workbench-rest-api" \
    org.opencontainers.image.vendor="The MITRE Corporation" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.authors="MITRE ATT&CK<attack@mitre.org>" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.created="${BUILDTIME}" \
    org.opencontainers.image.revision="${REVISION}" \
    maintainer="MITRE ATT&CK<attack@mitre.org>"

# Create app directory
WORKDIR /usr/src/app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

# Install the app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Set version as environment variable for runtime access
ENV APP_VERSION=${VERSION} \
    GIT_COMMIT=${REVISION} \
    BUILD_DATE=${BUILDTIME}

CMD [ "npm", "start" ]