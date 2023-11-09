/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */

const dedent = require("dedent");
const fs = require("fs");
const path = require("path");
const sql = require("mssql");
const { Client } = require("pg");

require("dotenv").config();

const { LANGUAGE_API_KEY, LANGUAGE_API_ENDPOINT, DATABASE_CONNECTION_STRING } =
  process.env;

const { PG_HOST, PG_PORT, PG_DATABASE, PG_USERNAME, PG_PASSWORD } = process.env;

/**
 * @type {Knex}
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
  // Your code here
  app.log.info("Yay, the app was loaded!");

  app.on("pull_request.closed", async (context) => {
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
      /*
      let tableCheckResult = await sql.query`
      SELECT *
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'SurveyResults'
    `;
      //*/
      let tableCheckResult = await knex.schema.hasTable("SurveyResults");

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
        

      let result =
        await sql.query`SELECT * FROM SurveyResults WHERE Issue_id = ${issue_id}`;
      app.log.info("Database has been created and issue id existence has been confirmed");

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

      if (result.recordset.length > 0) {
        // create query
        let update_query = `UPDATE [SurveyResults] SET [is_copilot_used] = ${isCopilotUsed? 1 : 0}, [completed_at] = '${context.payload.issue.updated_at}'`;
        if (assignee_name) {
          update_query += `, [assignee_name] = '${assignee_name}'`;
        }
        if (pctValue) {
          update_query += `, [saving_percentage] = '${pctValue}'`;
        }
        if (freqValue) {
          update_query += `, [usage_frequency] = '${freqValue}'`;
        }
        if (comment) {
          update_query += `, [comment] = '${comment}'`;
        }
        update_query += ` WHERE [issue_id] = ${issue_id}`;

        // update existing record
        let update_result = await sql.query(update_query);
        app.log.info(update_result);
        return update_query;
      } else {
        // check if dynamic values are present in context.payload
        let enterprise_name = null;
        let organization_name = null;
        if (context.payload.enterprise) {
          enterprise_name = context.payload.enterprise.name;
        }
        if(context.payload.organization){
          organization_name = context.payload.organization.login;
        }
        if(context.payload.organization){
          organization_name = context.payload.organization.login;
        }
        let insert_query = `INSERT INTO SurveyResults (
            enterprise_name,
            organization_name,
            repository_name,
            issue_id,
            issue_number,
            PR_number,
            assignee_name,
            is_copilot_used,
            saving_percentage,
            usage_frequency,
            comment,
            created_at,
            completed_at
          )
          VALUES (
            '${enterprise_name}',
            '${organization_name}',
            '${context.payload.repository.name}',
             ${issue_id},
             ${context.payload.issue.number},
             ${pr_number},
            '${assignee_name}',
             '${isCopilotUsed}',
            '${pctValue}',
            '${freqValue}',
            '${comment}',
            '${context.payload.issue.created_at}',
            '${context.payload.issue.updated_at}'
          )`;
        let insert_result = await sql.query(insert_query);
        app.log.info(insert_result);
        return insert_query;
      }
    } catch (err) {
      app.log.error(err);
    } finally {
      if (conn) {
        conn.close();
      }
    }
  }

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
