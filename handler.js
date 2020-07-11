/**
 * 
 * Copyright 2020 Victor Shinya
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 */
// https://www.npmjs.com/package/dotenv
require('dotenv').config()
// https://www.npmjs.com/package/ibm-cos-sdk
const { S3 } = require('ibm-cos-sdk')
// https://www.npmjs.com/package/request
const request = require('request-promise').defaults({ forever: true })
// https://nodejs.org/api/zlib.html
const { unzip } = require('zlib')
// https://nodejs.org/api/util.html
const util = require('util')
/**
 * 
 * IBM CLOUD OBJECT STORAGE
 * Endpoint access -> Endpoint, API Key and Instance ID
 * 
 */
var cos = new S3({
    endpoint: process.env.COS_ENDPOINT || '{endpoint}',
    apiKeyId: process.env.COS_APIKEY || '{apiKeyId}',
    ibmAuthEndpoint: 'https://iam.cloud.ibm.com/identity/token',
    serviceInstanceId: process.env.COS_INSTANCEID || '{serviceInstanceId}',
})
/**
 * 
 * IBM CLOUD OBJECT STORAGE
 * Using "From-To" logic with all logs
 * 
 */
const BUCKET_RECEIVER = process.env.COS_BUCKET_RECEIVER || '{bucketReceiver}'
const BUCKET_ARCHIVE = process.env.COS_BUCKET_ARCHIVE || '{bucketArchive}'
/**
 * 
 * IBM CLOUD OBJECT STORAGE
 * Set the max number of items to return
 * on `S3.listObjectsV2()` function
 * 
 */
const MAX_KEYS = 1
/**
 * 
 * IBM LOG ANALYSIS WITH LOGDNA
 * API Key and Hostname to send the logs
 * 
 */
const INGESTION_KEY = process.env.LOGDNA_INGESTION_KEY || '{ingestionKey}'
const HOSTNAME = process.env.LOGDNA_HOSTNAME || '{host}'
/**
 * 
 * PACKAGE PER REQUEST
 * To avoid `PayloadTooLarge` error
 * Use a value between '0' and '20000'
 * 
 */
const LOGS = 20000

async function uploadAndDeleteBucket(fileName) {
    try {
        console.log(`DEBUG: Uploading the log file`)
        await cos.copyObject({ Bucket: BUCKET_ARCHIVE, CopySource: `${BUCKET_RECEIVER}/${fileName}`, Key: fileName }).promise()
        console.log(`DEBUG: Deleting the log file`)
        await cos.deleteObject({ Bucket: BUCKET_RECEIVER, Key: fileName }).promise()
        return { status: 200, message: 'Update and delete log file DONE' }
    } catch (e) {
        console.error(e)
        return e
    }
}

async function sendLogDNA(json) {
    return await request({
        method: 'POST',
        url: `https://logs.us-south.logging.cloud.ibm.com/logs/ingest?hostname=${HOSTNAME}`,
        body: json,
        auth: {
            user: INGESTION_KEY
        },
        headers: { 'Content-Type': 'application/json' },
        json: true,
        timeout: 18000,
        agent: false,
        pool: { maxSockets: 200 }
    }).then(response => {
        return response
    }).catch(async (e) => {
        console.error(e)
        console.log('Retrying to send package')
        return await sendLogDNA(json)
    })
}

function split(buffer, tag) {
    var search = -1
    var lines = []

    while((search = buffer.indexOf(tag)) > -1) {
        lines.push(buffer.slice(0, search))
        buffer = buffer.slice(search + tag.length, buffer.length)
    }
    lines.push(buffer)
    return lines
}

async function downloadAndSend() {
    try {
        const lo = await cos.listObjectsV2({ Bucket: BUCKET_RECEIVER, MaxKeys: MAX_KEYS }).promise()
        if (lo.Contents.length === 0) {
            // Empty Bucket, return a HTTP status code 204 'No Content'
            return { status: 204, message: 'No new log file on COS Bucket' }
        } else {
            console.log(`DEBUG: log file = ${lo.Contents[0].Key}`)
            const o = await cos.getObject({ Bucket: BUCKET_RECEIVER, Key: lo.Contents[0].Key }).promise()
            const buffer = Buffer.from(o.Body)
            console.log(`DEBUG: Buffer length = ${buffer.length}`)
            if (buffer.length <= 28) {
                // Empty log file (normally with 28KB on CIS)
                return await uploadAndDeleteBucket(lo.Contents[0].Key, buffer)
            }
            const unzipPromise = util.promisify(unzip)
            const newBuffer = await unzipPromise(buffer)
            const tag = new Buffer.from('}')
            const sa = split(newBuffer, tag)
            sa.pop()
            var i, fj = { lines: [] }
            for (i = 0; i < sa.length; i++) {
                sa[i] += '}'
                var json = JSON.parse(sa[i])
                fj.lines.push({
                    timestamp: new Date().getTime(),
                    line: '[AUTOMATIC] LOG FROM IBM CLOUD INTERNET SERVICE',
                    app: 'logdna-cos',
                    level: 'INFO',
                    meta: {
                        customfield: json
                    }
                })
                if (i % LOGS === 0 || i === (sa.length - 1)) {
                    console.log(`DEBUG: Sending package = ${(i / LOGS + 1)}`)
                    const response = await sendLogDNA(fj)
                    console.log(`DEBUG: sendLogDNA response = ${JSON.stringify(response)}`)
                    // Example response body = {"status":"ok","batchID":""}
                    if (response && response.status === 'ok') {
                        fj.lines = []
                    }
                }
            }
            console.log(`DEBUG: uploadAndDeleteBucket`)
            return await uploadAndDeleteBucket(lo.Contents[0].Key)
        }
    } catch (e) {
        console.error(e)
        return { status: 500, message: JSON.stringify(e) }
    }
}

async function main() {
    console.time("LogDNA-COS")
    const response = await downloadAndSend()
    console.log(`DEBUG: downloadAndSend = ${JSON.stringify(response.message)}`)
    console.timeEnd("LogDNA-COS")
    // DEBUG::
    // switch (response.status) {
    //     case 200:
    //         console.log(`DEBUG: Fetch new log file`)
    //         await main()
    //         break
    //     case 204:
    //         console.log(`DEBUG: Wait 3 minutes to fetch new log file on COS Bucket`)
    //         await new Promise(r => setTimeout(r, 180000))
    //         await main()
    //         break
    //     default:
    //         console.log(`DEBUG: Uncommon behavior`)
    //         break
    // }
}

// DEBUG::
// main()

exports.main = main
