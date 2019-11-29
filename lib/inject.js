const BbPromise = require('bluebird');
const fse = require('fs-extra');
const glob = require('glob-all');
const get = require('lodash.get');
const set = require('lodash.set');
const path = require('path');
const JSZip = require('jszip');
const { writeZip, zipFile } = require('./zipTree');

BbPromise.promisifyAll(fse);

/**
 * Inject requirements into packaged application.
 * @param {string} modulePath module folder path
 * @param {string} packagePath target package path
 * @param {Object} options our options object
 * @return {Promise} the JSZip object constructed.
 */
function injectRequirements(modulePath, packagePath, options) {
  const noDeploy = new Set(options.noDeploy || []);

  return fse
    .readFileAsync(packagePath)
    .then(buffer => JSZip.loadAsync(buffer))
    .then(zip => {
      if (!options.zip) {
        const requirementsFolderPath = path.join(modulePath, 'requirements')
        return BbPromise.resolve(
          glob.sync([path.join(requirementsFolderPath, '**')], {
            mark: true,
            dot: true
          })
        )
        .map(file => [file, path.relative(requirementsFolderPath, file)])
        .filter(
          ([file, relativeFile]) =>
            !file.endsWith('/') &&
            !relativeFile.match(/^__pycache__[\\/]/) &&
            !noDeploy.has(relativeFile.split(/([-\\/]|\.py$|\.pyc$)/, 1)[0])
        )
        .map(([file, relativeFile]) =>
          Promise.all([file, relativeFile, fse.statAsync(file)])
        )
        .mapSeries(([file, relativeFile, fileStat]) =>
          zipFile(zip, relativeFile, fse.readFileAsync(file), {
            unixPermissions: fileStat.mode,
            createFolders: false
          })
        )
        .then(() => writeZip(zip, packagePath))
      } else {
        const requirementsZipPath = path.join(modulePath, '.requirements.zip');
        return BbPromise.resolve().then(() =>
          zipFile(zip, '.requirements.zip', fse.readFileAsync(requirementsZipPath), {
            unixPermissions: fse.statSync(requirementsZipPath).mode,
            createFolders: false
          })
        )
        .then(() => writeZip(zip, packagePath))
      }
    });
}

/**
 * Inject requirements into packaged application.
 * @return {Promise} the combined promise for requirements injection.
 */
function injectAllRequirements(funcArtifact) {
  if (this.options.layer) {
    // The requirements will be placed in a Layer, so just resolve
    return BbPromise.resolve();
  }

  this.serverless.cli.log('Injecting required Python packages to package...');

  if (this.serverless.service.package.individually) {
    return BbPromise.resolve(this.targetFuncs)
      .filter(func =>
        (func.runtime || this.serverless.service.provider.runtime).match(
          /^python.*/
        )
      )
      .map(func => {
        if (!get(func, 'module')) {
          set(func, ['module'], '.');
        }
        return func;
      })
      .map(func => injectRequirements(
        path.join('.serverless', func.module),
        func.package.artifact,
        this.options
      ));
  } else if (!this.options.zip) {
    return injectRequirements(
      '.serverless',
      this.serverless.service.package.artifact || funcArtifact,
      this.options
    );
  }
}

module.exports = { injectAllRequirements };
