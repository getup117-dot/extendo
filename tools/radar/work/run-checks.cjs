async function run() {
  const suites = [
    require('./check-beybe-radar.js'),
    require('./check-mobile.js'),
    require('./check-map-actions.js')
  ];
  let passed = 0;
  for (const suite of suites) {
    const checks = await suite();
    checks.forEach(check => console.log('OK ' + check));
    passed += checks.length;
  }
  console.log(passed + ' checks passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
