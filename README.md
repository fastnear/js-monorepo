# global `near` js

This project is a monorepo for various NPM packages scoped under `@fastnear/`. It's a TypeScript project that is a full rewrite, creating a new JavaScript library for building on NEAR Protocol.

The API itself (ergonomics, how you use it) will be changing more liberally until the release is out of alpha.

This repo also contains wallet-related packages, which provides an alternate path to the established wallet selector. While functional, the wallet side of this monorepo has seen less attention.

## Instructions

At this early stage, the best place to begin understanding this library is:

https://js.fastnear.com

It will load a demo. This section will be expanded with wonderfully simple commands you can run. All the final effort in delivering this was in code so far, and the demo.

## Using this repo

[Yarn](https://yarnpkg.com/getting-started/install) is used in this repo, and it's likely not the yarn commonly installed. You must run:

    yarn set version berry

    yarn build

Will go through all the workspaces packages (see `workspaces` key in `package.json`) and build them for ECMAScript, CommonJS, and a Universal Module Definition. This is achieved using [`esbuild`](https://esbuild.github.io).

## Hacking this repo

Remember that esbuild and similar systems separate the TypeScript evaluation, strict or not, and so we cannot assume that a successful `yarn build` means valid TypeScript.

    yarn type-check

During development, this was helpful:

    yarn type-check && yarn build

If the `tsc` call (that does not emit artifacts) finds an error, it'll stop before building.

Will run a command and catch TypeScript problems that should be fixed.

This repo has a `tsconfig.base.json` that is used in some packages during build. It currently has `strict: true` but it can be helpful to turn it off during particularly rapid development. It won't (shouldn't) harm your project to turn off strict mode. This library will seek to adhere to strict mode, but that does not cascade into demanding this from end developers.

## Compilations

Each workspace package (NPM module) has an `esbuild.config.mjs` file that's used to take the TypeScript files in the `src` directory and compile them to:

### 1. ESM (EcmaScript)

The modern JavaScript module system, primarily used for browser and server environments, and the default for most new packages.

### 2. CJS (CommonJS)

The older module system for NodeJS, ensuring backwards compatibility.

### 3. UMD (Universal Module Definition)

A universal module format that works in browsers (with or without a bundler) and in NodeJS, bridging the gap between different environments.

>Universal Module Definition (UMD) is a versatile module format that aims to provide compatibility across different environments, including both browsers and server-side applications. Unlike purely browser-centric solutions like AMD or server-specific formats like CommonJS, UMD offers a unified approach. It checks the environment and adapts accordingly, making it suitable for various scenarios without requiring major adjustments.
[source](https://www.devzery.com/post/your-guide-to-universal-module-definition)

## Contributing

All workspace packages publish a new version regardless of whether the package was modified.

Each package's `dist` folder is revisioned, so make sure to run build. Not intending to focus much on CI. 

## Bump the version

In the project root, open `package.json` and change the version that should be reflected in all packages.

    yarn constraints

The file `yarn.config.cjs` defines a Yarn constraint that takes the root manifest and updates all the workspace package versions based on that.

After you bump the version run `yarn build` again because the artifacts will be updated in the comments about the version.

## Publish to NPM

OTP is required and can be input into the command:

    yarn workspaces foreach --all -tv run release --access public --otp <OTP>

## IN PROGRESS

### Wallets

I've only been testing with MyNEARWallet for a wallet. There may be obvious issues in the other ones, I don't know :)

Generally, the most progress has been on the API. Expect to find more unaddressed wallet issues than API ones. And feel free to lean in, knowing it's alpha and greenfield. 

### Survey examples directory

Put attention there, could have unaddressed issues

### REPL

REPL is useful during development and is quite alpha.

## Attribution

Exports are coming from the `utils` package in this monorepo. Want to acknowledge the hard work that went into this, and show gratitude for their willingness to have open source licenses.

### `base58-js`

npm: [https://www.npmjs.com/package/base58-js](https://www.npmjs.com/package/base58-js)

MIT License:
https://github.com/pur3miish/base58-js/blob/9ae694c74f4556834ee7e88cd08ac686600eb7cf/LICENSE

### `borsh` (format)

The [Borsh](https://borsh.io) binary serialization format originated in the NEAR ecosystem. This monorepo includes `@fastnear/borsh`, a clean-room reimplementation that replaces the external `borsh` npm package (`borsh-js`). The implementation is not derived from `borsh-js` code.

### `@noble/curves`

npm: [https://www.npmjs.com/package/@noble/curves](https://www.npmjs.com/package/@noble/curves)

MIT License:
https://github.com/paulmillr/noble-curves/blob/e9eef8b76434ba9bc24f71189b05433d7c685a02/LICENSE

Note: we are currently exporting sha256 from this library, but I believe the Web API Crypto and Crypto.Subtle have this ability and that library export won't be needed.
