/**
 *
 * Copyright 2021 IBM Corp.
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
require("dotenv").config();
// https://www.npmjs.com/package/ibm-cos-sdk
const { S3 } = require("ibm-cos-sdk");
// https://www.npmjs.com/package/request
const request = require("request-promise").defaults({ forever: true });
// https://nodejs.org/api/zlib.html
const { unzip } = require("zlib");
// https://nodejs.org/api/util.html
const util = require("util");

const unzipPromise = util.promisify(unzip);
/**
 *
 * IBM CLOUD OBJECT STORAGE
 * Instance access through COS SDK
 * - Endpoint;
 * - API Key;
 * - Service Instance ID;
 * - Bucket for archive purpose.
 *
 */
let cos;
let BUCKET_ARCHIVE;
/**
 *
 * IBM LOG ANALYSIS WITH LOGDNA
 * API Key and Hostname to send the logs
 *
 */
let INGESTION_KEY;
let HOSTNAME;
/**
 *
 * PACKAGE PER REQUEST
 * To avoid `PayloadTooLarge` error
 * - LogDNA Ingest API has a limit of 10 MB/request
 *
 * A single log with all fields has 2 KB, in a
 * regular HTTP request. By default the number
 * of logs is set in 5000 logs per Ingest request
 *
 */
const LOGS = 5000;

async function uploadAndDeleteBucket(bucketReceiver, fileName) {
  try {
    console.log("DEBUG: Uploading the log file");
    await cos
      .copyObject({
        Bucket: BUCKET_ARCHIVE,
        CopySource: `${bucketReceiver}/${fileName}`,
        Key: fileName,
      })
      .promise();
    console.log("DEBUG: Deleting the log file");
    await cos
      .deleteObject({ Bucket: bucketReceiver, Key: fileName })
      .promise();
    return { status: 200, message: "Update and delete log file DONE" };
  } catch (e) {
    console.error(e);
    return e;
  }
}

function sendLogDNA(json) {
  return request({
    method: "POST",
    url: `https://logs.us-south.logging.cloud.ibm.com/logs/ingest?hostname=${HOSTNAME}`,
    body: json,
    auth: {
      user: INGESTION_KEY,
    },
    headers: { "Content-Type": "application/json" },
    json: true,
    timeout: 18000,
    agent: false,
    pool: { maxSockets: 200 },
  })
    .then((response) => response)
    .catch(async (e) => {
      console.error(e);
      console.log("Retrying to send package");
      return sendLogDNA(json);
    });
}

function split(buffer, tag) {
  let newBuffer = buffer;
  const lines = [];

  while (newBuffer.indexOf(tag) > -1) {
    lines.push(newBuffer.slice(0, newBuffer.indexOf(tag)));
    newBuffer = newBuffer.slice(
      newBuffer.indexOf(tag) + tag.length,
      newBuffer.length
    );
  }
  lines.push(newBuffer);
  return lines;
}

async function downloadAndSend(params) {
  try {
    const o = await cos
      .getObject({ Bucket: params.notification.bucket_name, Key: params.notification.object_name })
      .promise();
    console.log(`DEBUG: log file = ${params.notification.object_name}`);
    const buffer = Buffer.from(o.Body);
    console.log(`DEBUG: Buffer length = ${buffer.length}`);
    if (buffer.length <= 28) {
      // Empty log file (normally with 28KB on CIS)
      return await uploadAndDeleteBucket(params.notification.bucket_name, params.notification.object_name);
    }
    const newBuffer = await unzipPromise(buffer);
    const tag = new Buffer.from('\n');
    const sa = split(newBuffer, tag);
    sa.pop();
    const fj = { lines: [] };
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < sa.length; i += 1) {
      const json = JSON.parse(sa[i]);
      // Check whenever a field exists in the log line
      // - json.EdgeStartTimestamp is used when the code handles CIS Logpush for HTTP/HTTPS logs
      // - json.Datetime is used when the code handles CIS Logpush for Firewall logs
      const dateTime = json.EdgeStartTimestamp ? json.EdgeStartTimestamp : json.Datetime;
      fj.lines.push({
        timestamp: new Date(dateTime).getTime(),
        line: "[AUTOMATIC] LOG FROM IBM CLOUD INTERNET SERVICE",
        app: "logdna-cos",
        level: "INFO",
        meta: {
          customfield: json,
        },
      });
      if ((i > 0 && i % (LOGS - 1) === 0) || i === sa.length - 1) {
        console.log(`DEBUG: Sending package = ${i / LOGS + 1}`);
        const response = await sendLogDNA(fj);
        console.log(`DEBUG: sendLogDNA response = ${JSON.stringify(response)}`);
        // Example response body = {"status":"ok","batchID":""}
        if (response && response.status === "ok") {
          fj.lines = [];
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    console.log("DEBUG: uploadAndDeleteBucket");
    return await uploadAndDeleteBucket(params.notification.bucket_name, params.notification.object_name);
  } catch (e) {
    console.error(e);
    return { status: 500, message: JSON.stringify(e) };
  }
}

async function main(params) {
  console.time("LogDNA-COS");
  if (!cos) {
    cos = new S3({
      endpoint: params.endpoint,
      apiKeyId: params.apiKeyId,
      ibmAuthEndpoint: "https://iam.cloud.ibm.com/identity/token",
      serviceInstanceId: params.serviceInstanceId,
    });
  }
  if (!INGESTION_KEY || !HOSTNAME) {
    INGESTION_KEY = params.ingestionKey;
    HOSTNAME = params.hostname;
  }
  if (!BUCKET_ARCHIVE) {
    BUCKET_ARCHIVE = params.bucketArchive;
  }
  const response = await downloadAndSend(params);
  console.log(`DEBUG: downloadAndSend = ${JSON.stringify(response.message)}`);
  console.timeEnd("LogDNA-COS");
}

exports.main = main;
