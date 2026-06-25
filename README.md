# ATT&CK Workbench REST API

The ATT&CK Workbench is an application allowing users to **explore**, **create**, **annotate**, and **share** extensions of the MITRE ATT&CK® knowledge base.

This repository contains the REST API service for storing, querying, and editing ATT&CK objects. It is a Node.js application that uses a MongoDB database for persisting data.

## Quick Start

### Using Docker (Recommended)

```bash
# Create network
docker network create attack-workbench-network

# Run MongoDB
docker run --name attack-workbench-mongodb -d --network attack-workbench-network mongo:latest

# Run REST API
docker run -p 3000:3000 -d \
  --name attack-workbench-rest-api \
  --env DATABASE_URL=mongodb://attack-workbench-mongodb/attack-workspace \
  --network attack-workbench-network \
  ghcr.io/mitre-attack/attack-workbench-rest-api:latest
```

The REST API will be accessible at `http://localhost:3000`, with API documentation available at `http://localhost:3000/api-docs`.

### Full Application Deployment

For a full ATT&CK Workbench deployment, including the frontend application, see the official [Workbench Deployment Guide](https://github.com/mitre-attack/attack-workbench-deployment).

## Documentation

- [Usage Guide](USAGE.md): Comprehensive instructions for installing, configuring, and administering the REST API
- [Contributing Guide](CONTRIBUTING.md): Information for developers about contributing to the project
- [Data Model](docs/developer/data-model.md): Technical details about the data models used in the application

## Technical Information

The REST API provides:

- STIX 2.1 compliant object storage
- CRUD operations for ATT&CK objects (techniques, tactics, groups, software, etc.)
- Collection and versioning management
- User authentication and authorization
- API for programmatic access

## Related Repositories

- [ATT&CK Workbench Frontend](https://github.com/mitre-attack/attack-workbench-frontend): The user interface for the ATT&CK Workbench
- [ATT&CK Workbench TAXII 2.1 Server](https://github.com/mitre-attack/attack-workbench-taxii-server): An *optional* Workbench service for sharing STIX content through a TAXII 2.1-compliant interface
- [ATT&CK Workbench Deployment Guide](https://github.com/mitre-attack/attack-workbench-deployment): The official instructions and configuration templates for deploying Workbench in Docker

## Notice

Copyright 2020-2025 MITRE Engenuity. Approved for public release. Document number CT0020

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

This project makes use of ATT&CK®

[ATT&CK Terms of Use](https://attack.mitre.org/resources/terms-of-use/)
