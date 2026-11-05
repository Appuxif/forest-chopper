import {validMobPoses,captureMobPose,applyMobPose} from './mob-pose.js';
export const validHenPoses=value=>validMobPoses(value,{maxMobs:32,maxBones:32});
export const captureHenPose=captureMobPose;
export const applyHenPose=applyMobPose;
