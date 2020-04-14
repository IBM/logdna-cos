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
// https://www.npmjs.com/package/ibm-cos-sdk
const { S3 } = require('ibm-cos-sdk')
// https://nodejs.org/api/zlib.html
const { unzip } = require('zlib')
// https://www.npmjs.com/package/request
const request = require('request-promise').defaults({
    forever: true
})

function main() {

}

exports.main = main
