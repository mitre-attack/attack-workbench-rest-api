# Container builds

The [Dockerfile](../../Dockerfile) provides a `dev` target with development
dependencies and a default `production` target installed with `npm ci --omit=dev`.
For full application deployment, see the
[Workbench Deployment Guide](https://github.com/mitre-attack/attack-workbench-deployment).

## Building behind a corporate TLS proxy

Use a BuildKit-capable builder and an approved PEM file containing your
corporate CA certificates. Node adds these to its normal trusted certificates;
a combined public/corporate bundle can also be used. Use a combined bundle if
sharing it with the frontend's Alpine package-install step, which uses the
bundle as its CA file. Do not include private keys or registry credentials.

From the repository root:

```bash
# Set this to an existing approved file outside the repository/build context.
export BUILD_CA_CERT=/absolute/path/to/combined-ca.pem

# Production image.
docker build \
  --secret "id=build_ca_cert,src=${BUILD_CA_CERT:?Set BUILD_CA_CERT}" \
  -t attack-workbench-rest-api:local .

# Development image.
docker build --target dev \
  --secret "id=build_ca_cert,src=${BUILD_CA_CERT:?Set BUILD_CA_CERT}" \
  -t attack-workbench-rest-api:local-dev .
```

Compose builds can provide the same secret using `build.secrets` and a top-level
file-backed secret named `build_ca_cert`. The secret source must be accessible
to the builder and comply with the host's filesystem policy. See
[Docker's build-secret documentation](https://docs.docker.com/build/building/secrets/).

Without the optional secret, the Dockerfile leaves npm's normal trust
configuration in place. It does not disable certificate verification.

## Build-time trust versus runtime trust

Both installation stages mount the secret at `/run/secrets/build_ca_cert` and
set `NODE_EXTRA_CA_CERTS` only for their npm-install `RUN` instruction. The shell
export is not a persistent Dockerfile `ENV` setting. It does not configure
non-Node tools that dependency installation scripts might invoke.

Docker/BuildKit must separately trust the registry/proxy used to pull base
images and the Dockerfile syntax frontend image. Build secrets cannot repair
certificate failures that occur before their build instructions execute.

The running API still needs its existing runtime certificate mount and
`NODE_EXTRA_CA_CERTS` configuration when making requests through a corporate
TLS proxy. Install-time trust does not replace that configuration or install
corporate certificates into the image's runtime trust store. See the
[configuration guide](../admin/configuration.md).

## Secret handling and validation limits

BuildKit does not automatically persist the secret mount in image layers.
However, `COPY . .` can copy a bundle placed inside the build context unless
`.dockerignore` explicitly excludes it. Keep the source outside the build
context. Commands and dependency install scripts running during the
secret-mounted instruction can also read or copy the file; use trusted build
inputs and scripts. Local dotenv files, datasets, and workstation caches should
remain excluded from image builds.

The Dockerfile's `-s` check treats an empty secret as absent. Node warns and
ignores missing or malformed extra-CA files rather than necessarily terminating;
this does not disable normal TLS verification. Explicit TLS `ca` options can
also override the extra-CA mechanism. See
[`NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).
Do not treat a successful cached build as proof that a supplied bundle was
loaded or validated.

## Certificate rotation and build caching

Secret contents are not part of Docker's build-cache key. Changing the PEM
bundle alone does not force npm installation to run again. When verifying a
changed bundle, rerun the build with `--no-cache` and the same `--secret` option.
This re-executes the instructions without deleting existing images or globally
pruning the build cache. See
[Docker's secret cache behavior](https://docs.docker.com/build/cache/invalidation/#build-secrets).
