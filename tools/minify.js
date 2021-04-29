const minify = require("minify");
const fs = require("fs");
const path = require("path");

const options = {};

const htmlFiles = ["activate", "login", "schedule"];

for (let htmlFile of htmlFiles) {
    minify(path.join(__dirname, "..", "htmls", htmlFile + ".html"), options).then(res => {
        // Weird Visual Studio code bug where it marks the file with error 'expected ;', worth a few extra bytes in size to avoid seeing it.
        res = res.replace(/<script>/g, "<script>;");
        fs.writeFileSync(path.join(__dirname, "..", "htmlsMin", htmlFile + ".min.html"), res);
    }).catch(err => {
        console.log(err);
    });
}

const cssFiles = ["style"];

for (let cssFile of cssFiles) {
    minify(path.join(__dirname, "..", "public", cssFile + ".css"), options).then(res => {
        fs.writeFileSync(path.join(__dirname, "..", "public", cssFile + ".min.css"), res);
    }).catch(err => {
        console.log(err);
    });

}


console.log(`Done minifying ${htmlFiles.map(i => i + ".html").join(", ")} and ${cssFiles.map(i => i + ".css").join(", ")}`);