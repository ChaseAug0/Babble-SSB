// wrapper-db.js
// This file creates a patched version of ssb-db that fixes the mkdirp issue
// without causing infinite recursion

const originalSsbDb = require('ssb-db')
const path = require('path')
const os = require('os')
const fs = require('fs')
const mkdirp = require('mkdirp')

// 打印原始模块结构
console.log('Original SSB-DB structure:', Object.keys(originalSsbDb))
console.log('Original init function exists:', typeof originalSsbDb.init === 'function')

// 保存原始的mkdirp.sync函数 - 这很重要！
const originalMkdirpSync = mkdirp.sync;

// 创建一个修补过的模块
const patchedSsbDb = {
    // 复制原始模块的所有属性
    ...originalSsbDb,

    // 替换init函数
    init: function (api, opts) {
        console.log('Patched init called with api config:', api.config ? 'exists' : 'missing')
        console.log('Patched init called with opts:', opts ? 'exists' : 'missing')

        // 确保opts存在
        opts = opts || {}

        // 确保路径存在
        const configPath = (api.config && api.config.path) || opts.path || path.join(os.homedir(), '.ssb')
        console.log('Using path:', configPath)

        try {
            fs.mkdirSync(configPath, { recursive: true })
            console.log('Created directory:', configPath)
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error('Failed to create directory:', err)
            } else {
                console.log('Directory already exists:', configPath)
            }
        }

        // 设置路径到opts和api.config
        opts.path = configPath
        if (!api.config) api.config = {}
        api.config.path = configPath

        // 替换mkdirp.sync函数，但不会调用自己（避免递归）
        mkdirp.sync = function (dirPath) {
            if (dirPath === undefined) {
                console.warn('mkdirp received undefined path, using fallback:', configPath)
                dirPath = configPath
            }

            console.log('mkdirp creating directory:', dirPath)


            try {
                fs.mkdirSync(dirPath, { recursive: true })
                return dirPath
            } catch (err) {
                if (err.code !== 'EEXIST') {
                    throw err
                }
                return dirPath
            }
        }

        try {
            // 调用原始init
            console.log('Calling original init with fixed paths')
            return originalSsbDb.init(api, opts)
        } finally {
            // 恢复原始mkdirp函数
            console.log('Restoring original mkdirp.sync function')
            mkdirp.sync = originalMkdirpSync
        }
    }
}

module.exports = patchedSsbDb