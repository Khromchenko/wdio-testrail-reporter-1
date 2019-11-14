"use strict";
const fs = require('fs');
const resultsDirectory = './tmp-results';

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("@wdio/logger");
const reporter_1 = require("@wdio/reporter");
const node_fetch_1 = require("node-fetch");
const routes_1 = require("./routes");
class TestRailReporter extends reporter_1.default {
    constructor(options) {
        super(options);
        options = Object.assign(options, { stdout: false });
        this.obj = {};
        this.log = logger_1.default("custom-webdriver-v5-testrail-reporter");
        this.body = {
            results: [],
        };

        this.regex = options.regex || /[?\d]{6}/g;
        if (!options.testRailUrl ||
            !options.projectId ||
            !options.username ||
            !options.password ||
            !options.addRunSuiteId) {
            throw new Error("The following options are required for this reporter: testRailUrl, username, password, projectId, and addRunSuiteId. See documentation for more info.");
        }
        this.isDone = false;
        this.newRunId = null;
        this.newRunName = null;
        this.currentDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .substr(0, 19)
            .replace("T", " ");
        this.addRunBody = {
            description: options.addRunBodyDescription,
            name: 'Ignore',
            suite_id: options.addRunSuiteId,
            include_all: options.includeAll,
        };
    }
    onSuiteEnd(suite) {
        Object.assign(this.obj, suite);
    }
    onRunnerEnd(runnerStats) {

        return __awaiter(this, void 0, void 0, function* () {
            const addRunUrl = this.getFullUrl(routes_1.default.addRun(this.options.projectId));
            this.addRunBody.description = `${runnerStats.sanitizedCapabilities}`;
            try {
                // Create new testrail run over api. Note: it's a generator function which can be exited and later re-entered.
                yield this.createNewTestrailRun(addRunUrl, this.addRunBody);

                // Update same testrail runs with test results. Note: it's a generator function which can be exited and later re-entered.
                yield this.updateTests();

                // Game over
                yield this.sync();
            }
            catch (e) {
                this.fail(e);
            }
        });
    }
    get isSynchronised() {
        return this.isDone;
    }
    sync() {
        this.isDone = true;
    }
    fail(e) {
        this.sync(); // set to true to allow shutdown
        this.log.debug(e);
        process.exit(1);
    }
    getFullUrl(route) {
        return `https://${this.options.testRailUrl}/${route}`;
    }
    getTestState(state) {
        const testRailStatuses = {
            FAILED: 5,
            PASSED: 1,
            SKIPPED: 3,
        };
        if (state === "passed") {
            return testRailStatuses.PASSED;
        }
        else if (state === "failed") {
            return testRailStatuses.FAILED;
        }
        else if (state === "skipped") {
            return testRailStatuses.SKIPPED;
        }
        else {
            this.fail("Error finding Mocha test state");
            return 0;
        }
    }
    getPostData(url, body) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return node_fetch_1.default(url, {
                    body: JSON.stringify(body),
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Basic " + new Buffer(this.options.username + ":" + this.options.password).toString("base64"),
                    },
                    method: "POST",
                });
            }
            catch (e) {
                this.fail(e);
            }
        });
    }

    getData(url) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return node_fetch_1.default(url, {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Basic " + new Buffer(this.options.username + ":" + this.options.password).toString("base64"),
                    },
                    method: "GET",
                });
            }
            catch (e) {
                this.fail(e);
            }
        });
    }

    createNewTestrailRun(url, body) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Create new testrail run
                const response = yield this.getPostData(url, body);

                // If it was created
                if (response.ok) {
                    const data = yield response.json();

                    // Get all of the tests for specific run. 
                    const testRun = yield this.getData(this.getFullUrl(routes_1.default.getTests(data.id)));
                    const trData = yield testRun.json();

                    // Create a list of test case Ids
                    this.testCaseList = trData.map(x => x.case_id);

                    // Save testrail id of a new test run. It will be used in updateTests function
                    this.newRunId = data.id;
                    this.newRunName = data.name;
                    this.log.debug(`New TestRail Run created. ID: ${this.newRunId} Name: ${this.newRunName}`);
                }
                else {
                    throw new Error(`Unable to create TestRail Run: ${response.status} ${response.statusText}`);
                }
            }
            catch (e) {
                this.fail(e);
            }
        });
    }
    pushToResponse(iterateObj) {
        iterateObj.tests.forEach((test) => {
            if (test.title.match(this.regex) && this.testCaseList.includes(parseInt(test.title.match(this.regex)[0].substring(1)))) {
                const result = {
                    case_id: test.title.match(this.regex)[0].substring(1),
                    elapsed: test.duration,
                    status_id: this.getTestState(test.state),
                };
                // Add failures to the "comment" field
                if (result.status_id === this.getTestState("failed")) {
                    Object.assign(result, { comment: test.error.message });
                }
                this.body.results.push(result);
            }
            else {
                this.log.error("Unable to match case_id pattern in test title: ", test.title);
            }
        });
    }
    updateTests() {
        return __awaiter(this, void 0, void 0, function* () {
            // Get url to update test case results
            const addResultsForCasesURL = this.getFullUrl(routes_1.default.addResultsForCases(this.newRunId));

            // If there are is at least one test. Push it to request body
            if (this.obj.tests.length > 0) {
                this.pushToResponse(this.obj);
            }

            // THIS ONE IS ALWAYS EMPTY BASED ON A WDIO 5 UPDATES. IT COMES SEPARATELY FROM EACH SPEC FILE RUN(test file)
            // If there is at least one suite
            if (this.obj.suites.length > 0) {
                // If there are is at least one test in each suite. Push it to request body
                this.obj.suites.forEach((suite) => {
                    if (suite.tests.length > 0) {

                        this.pushToResponse(suite);
                    }
                    else {
                        this.log.error("No tests found on ", suite);
                    }
                });
            }
            try {
                // Create folder for test results
                if (!fs.existsSync(resultsDirectory)) {
                    fs.mkdirSync(resultsDirectory);
                }

                fs.appendFileSync(`./${resultsDirectory}/results${Date.now()}.json`, JSON.stringify(this.body));
                // Do not send results as we are saving them into file and will send separately after filtering
                // const response = yield this.getPostData(addResultsForCasesURL, this.body);
                this.log.info("Testrail has been updated successfully.");
            }
            catch (e) {
                this.fail(e);
            }
        });
    }
}
exports.default = TestRailReporter;
