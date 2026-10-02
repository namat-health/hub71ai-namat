import {verifyHackathonPackage} from './build-hackathon-site.mjs';

const result = verifyHackathonPackage();
console.log(`Hackathon package verified: ${result.files} files; only /welcome, its referenced assets and /api/hackathon. No deployment performed.`);
