/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */

const dedent = require("dedent");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { Parser } = require('@json2csv/plainjs');

require("dotenv").config();

const { LANGUAGE_API_KEY, LANGUAGE_API_ENDPOINT, DATABASE_CONNECTION_STRING } =
  process.env;

const { PG_HOST, PG_PORT, PG_DATABASE, PG_USERNAME, PG_PASSWORD } = process.env;

/**
 * @type {knex}
 */
const knex = require("knex")({
  client: "pg",
  connection: {
    host: PG_HOST,
    port: PG_PORT,
    database: PG_DATABASE,
    user: PG_USERNAME,
    password: PG_PASSWORD,
  },
});

module.exports = (app) => {
  app.log.info("Yay, the app was loaded!");

  app.on("pull_request.closed", async (context) => {
    let hasLicense = await hasCopilotLicense(context);
    if (!hasLicense) {
      return;
    }
    
    let pr_number = context.payload.pull_request.number;
    let pr_body = context.payload.pull_request.body;
    let detectedLanguage = "en";
    let pr_author = context.payload.pull_request.user.login;
    let organization_name = context.payload.repository.owner.login

    // check language for pr_body
    /*
    if (LANGUAGE_API_ENDPOINT && LANGUAGE_API_KEY) {
      const TAclient = new TextAnalysisClient(
        LANGUAGE_API_ENDPOINT,
        new AzureKeyCredential(LANGUAGE_API_KEY)
      );
      if (pr_body) {
        try {
          let startTime = Date.now();
          let result = await TAclient.analyze("LanguageDetection", [pr_body]);
          let duration = Date.now() - startTime;

          if (result.length > 0 && !result[0].error && ["en", "es", "pt", "fr"].includes(result[0].primaryLanguage.iso6391Name) ) {
            detectedLanguage = result[0].primaryLanguage.iso6391Name;
          }else {
            detectedLanguage = "en";
          }
        } catch (err) {
          app.log.error(err);
        }
      }
    }
    //*/
    
    // read file that aligns with detected language
    const issue_body = fs.readFileSync(
      "./issue_template/copilot-usage-" +
      detectedLanguage +
        ".md",
      "utf-8"
    );

    // find XXX in file and replace with pr_number
    let fileContent = dedent(
      issue_body.replace(/XXX/g, "#" + pr_number.toString())
    );

    // display the body for the issue
    app.log.info(fileContent);
    
    // create an issue using fileContent as body if pr_author is included in copilotSeats
    try {
      await context.octokit.issues.create({
        owner: organization_name,
        repo: context.payload.repository.name,
        title: "Copilot Usage - PR#" + pr_number.toString(),
        body: fileContent,
        assignee: context.payload.pull_request.user.login,
      });
    } catch (err) {
      app.log.error(err);
    }
  });

  app.on("issues.opened", async (context) => {
    if (context.payload.issue.title.startsWith("Request Survey Data as CSV")) {
      app.log.info(context.payload.issue.body);
      let reportDataRequested = context.payload.issue.labels.some((label) => label.name == "copilot survey data requested");
      if (reportDataRequested) {
        app.log.info("copilot survey data requested");
        await getReportData(context);
      }
    }

  });

  app.on("issues.labeled", async (context) => {

  });

  app.on("issues.edited", async (context) => {
    if (context.payload.issue.title.startsWith("Copilot Usage - PR#")) {
      await GetSurveyData(context);
    }
  });

  app.on("issue_comment.created", async (context) => {
    if (context.payload.issue.title.startsWith("Copilot Usage - PR#")) {
      await GetSurveyData(context);
    }
  });

  async function getReportData(context) {
    /* context.payload.issue.body contains a string with the following value:
    ### Start date:

01/01/2023

### End date:

12/31/2023
    */
    let issue_body = context.payload.issue.body;
    // extract start date and end date from issue_body
    let startDate = issue_body.match(/Start date:\n\n(.*)\n\n/)[1];
    let endDate = issue_body.match(/End date:\n\n(.*)/)[1];
    // get all rows from DB where date is between startDate and endDate
    let results = await knex
      .select("*")
      .from("SurveyResults")
      .whereBetween("completed_at", [startDate, endDate]);

    let resultsJSON = JSON.stringify(results);
    let resultsCSV = new Parser().parse(results);
    
    app.log.info(resultsCSV);

  }

  async function GetSurveyData(context) {
    let issue_body = context.payload.issue.body;
    let issue_id = context.payload.issue.id;

    // save comment body if present
    let comment = null;
    if(context.payload.comment) {
      comment = context.payload.comment.body;
    }

    // find regex [0-9]\+ in issue_body and get first result
    let pr_number = issue_body.match(/[0-9]+/)[0];

    // find regex \[x\] in issue_body and get complete line in an array
    let checkboxes = issue_body.match(/\[x\].*/g);

    // find if checkboxes array contains Sim o Si or Yes
    let isCopilotUsed = checkboxes.some((checkbox) => {
      return (
        checkbox.includes("Sim") ||
        checkbox.includes("Si") ||
        checkbox.includes("Yes") ||
        checkbox.includes("Oui")
      );
    });

    // if there's a comment, insert it into the DB regardless of whether the user answered the survey or not
    if (comment) {
      let startTime = Date.now();
      let query = await insertIntoDB(context, issue_id, pr_number, isCopilotUsed, null, null, comment);
      let duration = Date.now() - startTime;
    }

    if (isCopilotUsed) {
      let startTime = Date.now();
      let query = await insertIntoDB(context, issue_id, pr_number, isCopilotUsed, null, null, comment);
      let duration = Date.now() - startTime;

      // loop through checkboxes and find the one that contains %
      let pctSelected = false;
      let pctValue = new Array();
      for (const checkbox of checkboxes) {
        if (checkbox.includes("%")) {
          pctSelected = true;
          copilotPercentage = checkbox;
          copilotPercentage = copilotPercentage.replace(/\[x\] /g, "");
          pctValue.push(copilotPercentage);
          app.log.info(copilotPercentage);
        }
      }
      if (pctSelected) {
        //if percentage is selected, insert into DB
        let startTime = Date.now();
        let query = await insertIntoDB(context, issue_id, pr_number, isCopilotUsed, pctValue, null, comment);
        let duration = Date.now() - startTime;
      }

      // loop through checkboxes and find the ones that do not contain % and are not Yes or No
      let freqSelected = false;
      let freqValue = new Array();
      for (const checkbox of checkboxes) {
        if (
          !checkbox.includes("%") &&
          !checkbox.includes("Sim") &&
          !checkbox.includes("Si") &&
          !checkbox.includes("Yes") &&
          !checkbox.includes("Oui") &&
          !checkbox.includes("Não") &&
          !checkbox.includes("No") &&
          !checkbox.includes("Non")
        ) {
          freqSelected = true;
          frequencyValue = checkbox;
          frequencyValue = frequencyValue.replace(/\[x\] /g, "");
          freqValue.push(frequencyValue);
          app.log.info(frequencyValue);
        }
      }

      if (freqSelected) {
        //if frequency is selected, insert into DB
        let startTime = Date.now();
        let query = await insertIntoDB(context, issue_id, pr_number, isCopilotUsed, null, freqValue, comment);
        let duration = Date.now() - startTime;
      }

      if( pctSelected && freqSelected ){
        // close the issue
        try {
          await context.octokit.issues.update({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            issue_number: context.payload.issue.number,
            state: "closed",
          });
        } catch (err) {
          app.log.error(err);
        }
      }
    } else {
      if (
        checkboxes.some((checkbox) => {
          return (
            checkbox.includes("Não") ||
            checkbox.includes("No") ||
            checkbox.includes("Non")
          );
        })
      ) {
        let startTime = Date.now();
        let query = await insertIntoDB(context, issue_id, pr_number, isCopilotUsed, null, null, comment);
        let duration = Date.now() - startTime;

        if (comment) {
          try {
            // close the issue
            await context.octokit.issues.update({
              owner: context.payload.repository.owner.login,
              repo: context.payload.repository.name,
              issue_number: context.payload.issue.number,
              state: "closed",
            });
          } catch (err) {
            app.log.error(err);
          }
        }
      }
    }
  }

  async function hasCopilotLicense(context) {
    let hasLicense = false;
    try {
      const response = await context.octokit.request('GET /orgs/{org}/copilot/billing/seats', {
        org: context.payload.organization.login,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if ( response.data.total_seats != undefined && response.data.total_seats > 0 ) {
        response.data.seats.forEach(seat => {
          if ( seat.assignee.login == context.payload.sender.login ) {
            app.log.info(`User ${context.payload.sender.login} has a copilot license issued by ${context.payload.organization.login}`);
            hasLicense = true;
          }
        });
      }
      if (!hasLicense) {
        app.log.info(`User ${context.payload.sender.login} does not have a copilot license issued by ${context.payload.organization.login}`);
      }
      
      return hasLicense;
    } 
    catch (err) {
      app.log.error(err);
      return false;
    }
  }

  async function insertIntoDB(
    context,
    issue_id,
    pr_number,
    isCopilotUsed,
    pctValue,
    freqValue,
    comment
  ) {
    let conn = null;
    try {
      //conn = await sql.connect(DATABASE_CONNECTION_STRING);

      // Check if table exists
      const tableCheckResult = await knex.schema.hasTable("SurveyResults");

      /*
      if (tableCheckResult.recordset.length === 0) {
        // Create table if it doesn't exist
        await sql.query`
        CREATE TABLE SurveyResults (
          record_ID int IDENTITY(1,1),  
          enterprise_name varchar(50),
          organization_name varchar(50),
          repository_name varchar(50),
          issue_id int,
          issue_number varchar(20),
          PR_number varchar(20),
          assignee_name varchar(50),
          is_copilot_used BIT,
          saving_percentage varchar(25),
          usage_frequency varchar(50),
          comment varchar(255),
          created_at DATETIME,
          completed_at DATETIME
      );
      `;
      }
      //*/

      if (!tableCheckResult) {
        // Create table if it doesn't exist
        await knex.schema.createTable("SurveyResults", (table) => {
          table.increments("record_ID");
          table.string("enterprise_name", 50);
          table.string("organization_name", 50);
          table.string("repository_name", 50);
          table.integer("issue_id");
          table.string("issue_number", 20);
          table.string("PR_number", 20);
          table.string("assignee_name", 50);
          table.boolean("is_copilot_used");
          table.string("saving_percentage", 25);
          table.string("usage_frequency", 50);
          table.string("comment", 255);
          table.dateTime("created_at");
          table.dateTime("completed_at");
        });  
      }

      // let result =
      //   await sql.query`SELECT * FROM SurveyResults WHERE Issue_id = ${issue_id}`;
      // app.log.info("Database has been created and issue id existence has been confirmed");

      // Get a result for the issue_id if it exists
      let result = await knex("SurveyResults").where("issue_id", issue_id);

      // convert pctValue to string
      if (pctValue) {
        pctValue = pctValue.toString();
      }
      // convert freqValue to string
      if (freqValue) {
        freqValue = freqValue.toString();
      }

      let assignee_name = null;
      if (context.payload.issue.assignee) {
        assignee_name = context.payload.issue.assignee.login;
      }

      // If there are no results for the issue_id, insert a new record using knex, otherwise update the existing record using knex
      if (result.length === 0) {
        // insert new record
        await knex("SurveyResults").insert({
          enterprise_name: context.payload.enterprise.slug,
          organization_name: context.payload.organization.login,
          repository_name: context.payload.repository.name,
          issue_id: issue_id,
          issue_number: context.payload.issue.number,
          PR_number: pr_number,
          assignee_name: assignee_name,
          is_copilot_used: isCopilotUsed,
          saving_percentage: pctValue,
          usage_frequency: freqValue,
          comment: comment,
          created_at: context.payload.issue.created_at,
          completed_at: context.payload.issue.updated_at,
        });
      } else {
        // update existing record
        await knex("SurveyResults")
          .where("issue_id", issue_id)
          .update({
            is_copilot_used: isCopilotUsed,
            completed_at: context.payload.issue.updated_at,
            assignee_name: assignee_name,
            saving_percentage: pctValue,
            usage_frequency: freqValue,
            comment: comment,
          });
      }

    } catch (err) {
      app.log.error(err);
    } finally {
      if (conn) {
        conn.close();
      }
    }
  }
};
