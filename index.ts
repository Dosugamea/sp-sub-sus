import 'dotenv/config'
import express from 'express'
import { Request, Response, NextFunction } from 'express'
import { GetObjectCommand, GetObjectCommandOutput, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { fromSus } from "sonolus-pjsekai-engine"
import { gzipPromise, streamToString } from './utils'
import { Readable } from 'stream'
import crypto from 'crypto'

interface S3Error {
    Code: string
    $metadata: {
        httpStatusCode: string
    }
}

interface PostConvert {
    hash: string
}


const app = express()
const bucket: string = process.env.S3_BUCKET!
const s3 = new S3Client({
    credentials: {
        accessKeyId: process.env.S3_KEY!,
        secretAccessKey: process.env.S3_SECRET!,
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    region: process.env.S3_REGION || 'unknown',
})

app.use(express.json())

app.post("/convert", async (req: express.Request, res: express.Response) => {
    const { hash }: PostConvert = req.body
    let content: GetObjectCommandOutput
    try {
        console.log(hash)
        content = await s3.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: `SusFile/${hash}`
            })
        )
    } catch (e: any) {
        switch (e.code) {
            case "NoSuchBucket":
                res.status(404).send({
                    error: "File not found",
                    code: "file_not_found"
                })
                break
            default:
                console.log("Error while getting file:", e)
                res.status(500).send({
                    error: "Internal Server Error",
                    code: "internal_server_error"
                })
                break
        }
        return
    }
    const body = content.Body as Readable
    const data = await fromSus(await streamToString(body))
    const compressed = await gzipPromise(JSON.stringify(data))
    const compressedBuffer = Buffer.from(compressed)
    const compressedHash = crypto.createHash('sha1').update(compressedBuffer).digest('hex')
    try {
        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: `LevelData/${compressedHash}`,
                Body: compressedBuffer
            })
        )
    } catch (e: unknown) {
        if (isError(e)) {
            const err: S3Error = e
            console.log(`S3 PutObject Error: ${err.$metadata.httpStatusCode} / ${err.Code}`)
        }
    }
    res.json({
        hash: compressedHash
    })
})

app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ message: 'Not found' })
})

if (require.main === module) {
    const port = process.env.PORT || 3000
    app.listen(+port, "0.0.0.0", () => {
        console.log(`Server listening on port ${port}`)
    })
}