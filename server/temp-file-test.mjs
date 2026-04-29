import 'dotenv/config'
import { CertificatesService } from './dist/services/certificates.service.js'

const service = new CertificatesService()
const certificateId = '7964b6ec-f58d-46dd-9cd7-95cfadb0d1e8'

try {
  const result = await service.getCertificatePdfFile(certificateId, {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'admin@example.com',
    role: 'super_admin',
  })
  console.log('result fileName', result.fileName)
  console.log('byte length', result.bytes.length)
  console.log('starts with', result.bytes.slice(0, 4).toString())
} catch (error) {
  console.error('error', error)
  process.exit(1)
}
