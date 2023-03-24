This is a sample cdk code to create appsync using JS run time.
References:
References for graphql part:https://www.youtube.com/watch?v=_9DFFg-pNss&ab_channel=NaderDabit
References for cdk part: https://www.youtube.com/watch?v=DOGadkjV7Hs&t=315s&ab_channel=NaderDabit
References for JS runtime part:
https://youtu.be/LyzNM9KIJSU?t=3046
https://github.com/TheLetterTheta/Zeitplan/blob/64bb9611fc19de626b875966036065671577d702/infrastructure/lib/zeitplan-cdk.ts
https://github.com/onlybakam/reinvent2022-vote-app/blob/main/cdk/lib/cdk-stack.ts

modification were made to cdk so it work with JS run time.

resolverCode and resolverFunctionCode are in JS. However, we can also write them on TS and then read the JS after bundling.

commands:
yan install
cdk bootstrap
cdk synth
cdk deploy
