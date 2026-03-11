const fs = require('fs');
const path = require('path');
const LinkedInAPI = require('./utils/linkedin-api.js');

async function testLinkedInImage() {
    const api = new LinkedInAPI();
    try {
        const dummyPath = path.join(__dirname, 'test.jpg');
        // create a tiny 1x1 black valid JPG
        const b64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
        fs.writeFileSync(dummyPath, Buffer.from(b64, 'base64'));

        console.log("File created, uploading...");
        const mediaUrn = await api.uploadImage(dummyPath);
        console.log("Upload success! URN:", mediaUrn);

        console.log("Creating post with URN...");
        const postRes = await api.createPost("Testing automated image support via API", mediaUrn);
        console.log("Post success!", postRes);

        fs.unlinkSync(dummyPath);
    } catch (e) {
        console.error("Failed:", e.message);
    }
}
testLinkedInImage();
