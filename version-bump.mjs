import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version || process.argv[2];

// 读取 manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// 更新 versions.json
let versions = {};
try {
    versions = JSON.parse(readFileSync("versions.json", "utf8"));
} catch (e) {
    // 文件不存在，创建新的
}
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
