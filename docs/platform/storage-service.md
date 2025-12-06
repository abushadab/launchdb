# Storage Service Documentation

The Storage Service provides per-project file storage with bucket-based organization and signed URL support. Each project has isolated file storage, allowing project owners to manage files independently.

## Base URL

```
http://localhost:3002
```

## Architecture

- **Per-Project Isolation:** Files stored in project-specific directories
- **Bucket Organization:** Organize files into buckets (similar to AWS S3)
- **Signed URLs:** Temporary access URLs with expiration
- **Direct Upload/Download:** Support for direct file operations
- **Metadata Storage:** File metadata stored in per-project database

---

## Storage Structure

```
storage/
└── {projectId}/
    └── {bucket}/
        └── {path}/
            └── file.ext
```

**Example:**
```
storage/proj_802682481788fe51/avatars/users/user123.jpg
storage/proj_802682481788fe51/documents/reports/2025/annual-report.pdf
```

---

## Endpoints

All Storage Service endpoints are scoped per project: `/storage/:projectId/*`

### Health Check

#### `GET /health`

Health check endpoint for monitoring.

**Authentication:** None required

**Response:**

```json
{
  "status": "ok",
  "service": "storage-service"
}
```

---

## File Operations

### Upload File

#### `POST /storage/:projectId/:bucket/*`

Upload a file to specified bucket and path.

**Authentication:** Required (project JWT token in Authorization header)

**URL Parameters:**
- `projectId`: Project ID (format: `proj_[16 hex chars]`)
- `bucket`: Bucket name (e.g., `avatars`, `documents`)
- `*`: File path within bucket (e.g., `users/user123.jpg`)

**Query Parameters:**
- `bucket` (optional): Override URL bucket parameter

**Request Body:** `multipart/form-data`
- `file`: File to upload (binary)

**Headers:**
```
Authorization: Bearer <project_anon_key or service_role_key>
Content-Type: multipart/form-data
```

**Response:** `201 Created`

```json
{
  "object_id": "123e4567-e89b-12d3-a456-426614174000",
  "bucket": "avatars",
  "path": "users/user123.jpg",
  "size": 245678,
  "content_type": "image/jpeg",
  "uploaded_at": "2025-12-04T10:00:00.000Z",
  "url": "http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg"
}
```

**Example (curl):**

```bash
curl -X POST \
  http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg \
  -H "Authorization: Bearer <anon_key>" \
  -F "file=@profile.jpg"
```

**Example (JavaScript):**

```javascript
const formData = new FormData();
formData.append('file', fileBlob, 'user123.jpg');

const response = await fetch(
  'http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <anon_key>',
    },
    body: formData,
  }
);

const data = await response.json();
```

**Error Responses:**

```json
// 400 Bad Request - No file provided
{
  "statusCode": 400,
  "message": "No file provided",
  "error": "Bad Request"
}

// 401 Unauthorized - Missing or invalid token
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}

// 413 Payload Too Large - File exceeds size limit
{
  "statusCode": 413,
  "message": "File size exceeds limit",
  "error": "Payload Too Large"
}
```

---

### Download File

#### `GET /storage/:projectId/:bucket/*`

Download a file from storage.

**Authentication:** Required (project JWT token or signed URL token)

**URL Parameters:**
- `projectId`: Project ID
- `bucket`: Bucket name
- `*`: File path within bucket

**Query Parameters:**
- `token` (optional): Signed URL token for temporary access

**Headers:**
```
Authorization: Bearer <project_anon_key or service_role_key>
```

Or use signed URL:
```
GET /storage/proj_xxx/bucket/path?token=<signed_token>
```

**Response:** `200 OK`

Binary file stream with headers:
```
Content-Type: image/jpeg
Content-Length: 245678
Content-Disposition: inline; filename="user123.jpg"
```

**Example (curl):**

```bash
# With authorization header
curl -X GET \
  http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg \
  -H "Authorization: Bearer <anon_key>" \
  -o downloaded.jpg

# With signed URL token
curl -X GET \
  "http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg?token=<signed_token>" \
  -o downloaded.jpg
```

**Example (JavaScript):**

```javascript
// With authorization
const response = await fetch(
  'http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg',
  {
    headers: {
      'Authorization': 'Bearer <anon_key>',
    },
  }
);

const blob = await response.blob();
const url = URL.createObjectURL(blob);

// Display image
document.getElementById('avatar').src = url;
```

**Error Responses:**

```json
// 401 Unauthorized - Missing or invalid token
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 Not Found - File doesn't exist
{
  "statusCode": 404,
  "message": "File not found",
  "error": "Not Found"
}
```

---

### Delete File

#### `DELETE /storage/:projectId/:bucket/*`

Delete a file from storage.

**Authentication:** Required (project JWT token with appropriate permissions)

**URL Parameters:**
- `projectId`: Project ID
- `bucket`: Bucket name
- `*`: File path within bucket

**Headers:**
```
Authorization: Bearer <project_service_role_key>
```

**Response:** `200 OK`

```json
{
  "message": "File deleted successfully"
}
```

**Example (curl):**

```bash
curl -X DELETE \
  http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg \
  -H "Authorization: Bearer <service_role_key>"
```

**Example (JavaScript):**

```javascript
const response = await fetch(
  'http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg',
  {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer <service_role_key>',
    },
  }
);

const data = await response.json();
// { message: 'File deleted successfully' }
```

**Error Responses:**

```json
// 401 Unauthorized - Missing or invalid token
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 403 Forbidden - Insufficient permissions
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}

// 404 Not Found - File doesn't exist
{
  "statusCode": 404,
  "message": "File not found",
  "error": "Not Found"
}
```

---

## Signed URLs

### Create Signed URL

#### `POST /storage/:projectId/sign`

Generate a temporary signed URL for file access without authentication.

**Authentication:** Required (project JWT token)

**URL Parameters:**
- `projectId`: Project ID

**Request Body:**

```json
{
  "path": "users/user123.jpg",
  "bucket": "avatars",
  "expires_in": 300
}
```

**Fields:**
- `path` (required): File path within bucket
- `bucket` (optional): Bucket name (default: `default`)
- `expires_in` (optional): Expiration time in seconds (60-3600, default: 300)

**Response:** `200 OK`

```json
{
  "url": "http://localhost:3002/storage/proj_802682481788fe51/avatars/users/user123.jpg?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2025-12-04T10:05:00.000Z"
}
```

**Example (curl):**

```bash
curl -X POST \
  http://localhost:3002/storage/proj_802682481788fe51/sign \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "users/user123.jpg",
    "bucket": "avatars",
    "expires_in": 3600
  }'
```

**Example (JavaScript):**

```javascript
const response = await fetch(
  'http://localhost:3002/storage/proj_802682481788fe51/sign',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <service_role_key>',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'users/user123.jpg',
      bucket: 'avatars',
      expires_in: 3600, // 1 hour
    }),
  }
);

const data = await response.json();
// Use data.url for temporary access
```

**Use Case Example:**

```javascript
// Server-side: Generate signed URL
const signedUrlResponse = await createSignedUrl({
  path: 'private/report.pdf',
  bucket: 'documents',
  expires_in: 300, // 5 minutes
});

// Send URL to client
res.json({ downloadUrl: signedUrlResponse.url });

// Client-side: Use signed URL (no auth needed)
<a href="${signedUrlResponse.url}" download>Download Report</a>
```

**Error Responses:**

```json
// 400 Bad Request - Validation error
{
  "statusCode": 400,
  "message": ["expires_in must be between 60 and 3600"],
  "error": "Bad Request"
}

// 401 Unauthorized - Missing or invalid token
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 Not Found - File doesn't exist
{
  "statusCode": 404,
  "message": "File not found",
  "error": "Not Found"
}
```

---

## Storage Database Schema

File metadata is stored in the per-project database in the `storage.objects` table:

```sql
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  size BIGINT NOT NULL,
  content_type VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (bucket, path)
);

CREATE INDEX idx_objects_bucket ON storage.objects(bucket);
CREATE INDEX idx_objects_path ON storage.objects(path);
```

---

## Bucket Naming Conventions

- **Lowercase only:** `avatars`, `documents`, `images`
- **No spaces:** Use hyphens for multi-word names (`user-uploads`)
- **Alphanumeric and hyphens:** `[a-z0-9-]+`
- **Examples:**
  - ✅ `avatars`
  - ✅ `user-documents`
  - ✅ `profile-images`
  - ❌ `User Documents` (spaces)
  - ❌ `AVATARS` (uppercase)

---

## File Size Limits

**Default Limits:**
- Maximum file size: 50MB per file
- Maximum total storage per project: 10GB (v1)

**Configuration:** Limits can be adjusted via environment variables (see Configuration section).

---

## Supported File Types

All file types are supported. Common MIME types:

| Extension | MIME Type |
|-----------|-----------|
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.gif` | `image/gif` |
| `.pdf` | `application/pdf` |
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| `.zip` | `application/zip` |
| `.mp4` | `video/mp4` |
| `.mp3` | `audio/mpeg` |

---

## Security Considerations

1. **Authentication:**
   - Use `anon_key` for client-side uploads (with RLS policies)
   - Use `service_role_key` for server-side operations
   - Use signed URLs for temporary public access

2. **Row Level Security (RLS):**
   - Define RLS policies on `storage.objects` table
   - Restrict uploads/downloads based on user roles
   - Example: Users can only access their own files

3. **File Validation:**
   - Validate file types on upload
   - Scan for malware (v1.1)
   - Check file size limits

4. **Signed URL Security:**
   - Short expiration times (5-60 minutes)
   - One-time use tokens (v1.1)
   - IP-based restrictions (v1.1)

---

## Client SDK Example

### JavaScript/TypeScript SDK

```typescript
class StorageClient {
  private baseUrl: string;
  private projectId: string;
  private authToken: string;

  constructor(baseUrl: string, projectId: string, authToken: string) {
    this.baseUrl = baseUrl;
    this.projectId = projectId;
    this.authToken = authToken;
  }

  async upload(bucket: string, path: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${this.baseUrl}/storage/${this.projectId}/${bucket}/${path}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    return response.json();
  }

  async download(bucket: string, path: string): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl}/storage/${this.projectId}/${bucket}/${path}`,
      {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Download failed');
    }

    return response.blob();
  }

  async delete(bucket: string, path: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/storage/${this.projectId}/${bucket}/${path}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Delete failed');
    }
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number = 300
  ): Promise<{url: string, expires_at: Date}> {
    const response = await fetch(
      `${this.baseUrl}/storage/${this.projectId}/sign`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bucket, path, expires_in: expiresIn }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to create signed URL');
    }

    return response.json();
  }

  getPublicUrl(bucket: string, path: string): string {
    return `${this.baseUrl}/storage/${this.projectId}/${bucket}/${path}`;
  }
}

// Usage
const storage = new StorageClient(
  'http://localhost:3002',
  'proj_802682481788fe51',
  '<anon_key or service_role_key>'
);

// Upload
const file = document.getElementById('fileInput').files[0];
const result = await storage.upload('avatars', 'users/user123.jpg', file);

// Download
const blob = await storage.download('avatars', 'users/user123.jpg');
const url = URL.createObjectURL(blob);
document.getElementById('avatar').src = url;

// Create signed URL
const signed = await storage.createSignedUrl('documents', 'report.pdf', 3600);
console.log('Temporary URL:', signed.url);

// Delete
await storage.delete('avatars', 'users/user123.jpg');
```

---

## Testing

### Local Development

```bash
# Storage Service runs on port 3002
curl http://localhost:3002/health
```

### Test Flow

```bash
# 1. Upload file
curl -X POST \
  http://localhost:3002/storage/proj_802682481788fe51/test/file.txt \
  -H "Authorization: Bearer <anon_key>" \
  -F "file=@test.txt"

# 2. Download file
curl -X GET \
  http://localhost:3002/storage/proj_802682481788fe51/test/file.txt \
  -H "Authorization: Bearer <anon_key>" \
  -o downloaded.txt

# 3. Create signed URL
curl -X POST \
  http://localhost:3002/storage/proj_802682481788fe51/sign \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"path":"file.txt","bucket":"test","expires_in":300}'

# 4. Download with signed URL (no auth needed)
curl -X GET \
  "http://localhost:3002/storage/proj_802682481788fe51/test/file.txt?token=<signed_token>" \
  -o downloaded.txt

# 5. Delete file
curl -X DELETE \
  http://localhost:3002/storage/proj_802682481788fe51/test/file.txt \
  -H "Authorization: Bearer <service_role_key>"
```

---

## Error Codes Reference

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | Bad Request | Invalid request or missing file |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions (RLS policy violation) |
| 404 | Not Found | File or project not found |
| 413 | Payload Too Large | File exceeds size limit |
| 500 | Internal Server Error | Server error during operation |

---

## Future Enhancements (v1.1)

1. **Image Processing:** Automatic resizing, thumbnails, format conversion
2. **CDN Integration:** Cloudflare, AWS CloudFront for faster delivery
3. **Resumable Uploads:** Support for large file uploads with resume capability
4. **Virus Scanning:** Automatic malware detection on upload
5. **File Versioning:** Keep multiple versions of files
6. **Bandwidth Limits:** Per-project bandwidth quotas
7. **One-Time URLs:** Signed URLs that expire after first use
8. **Compression:** Automatic compression for images and documents

---

## See Also

- [Platform API Documentation](./platform-api.md) - Project management and proxy
- [Auth Service Documentation](./auth-service.md) - Per-project authentication
- [Database Schema](./database-schema.md) - Platform and project database schemas
- [Environment Variables](./platform-env-vars.md) - Configuration reference
