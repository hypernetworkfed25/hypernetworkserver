const { Client } = require('@notionhq/client');
const isEmpty = require('lodash/fp/isEmpty');
const compact = require('lodash/fp/compact');
const omit = require('lodash/fp/omit');
const uniq = require('lodash/fp/uniq');

const convertProgramsQueryToNotionFilters = ({ programs = [] }) => {
  return isEmpty(programs) ? [] : programs.map((program) => ({ property: 'Program', select: { equals: program } }));
};

const convertLanguagesQueryToNotionFilters = ({ languages }) => {
  return isEmpty(languages)
    ? []
    : languages.map((language) => ({
        property: 'Languages',
        multi_select: {
          contains: language,
        },
      }));
};

const queryNotionDatabase = async (notionKey, databaseId, filter) => {
  const notion = new Client({ auth: notionKey });

  const result = isEmpty(filter)
    ? {}
    : await notion.databases.query({
        database_id: databaseId,
        filter,
      });

  return result;
};

const convertHyperNetworkResultsToStudents = (hyperNetworkResults) => {
  const { results = [] } = hyperNetworkResults;
  const students = results.map(({ properties }) => {
    return {
      portfolio: properties['Portfolio']?.url || '',
      hyperEmail: properties['Hyper Email']?.email || '',
      contactRelation: properties['Contact']?.relation && properties['Contact'].relation[0] ? properties['Contact'].relation[0].id : '',
      lastName:
        properties['Last Name']?.rich_text && properties['Last Name']?.rich_text[0] ? properties['Last Name']?.rich_text[0].plain_text : '',
      firstName:
        properties['First Name']?.rich_text && properties['First Name']?.rich_text[0]
          ? properties['First Name']?.rich_text[0].plain_text
          : '',
      availability: properties['Availability']?.select ? properties['Availability']?.select.name : '',
      hardSkillsRelation: properties['Hard Skills']?.relation ? properties['Hard Skills']?.relation.map(({ id }) => id) : [],
      languages: properties['Languages']?.multi_select ? properties['Languages']?.multi_select.map(({ name }) => name) : [],
      program: properties['Program']?.select ? properties['Program']?.select.name : '',
      id: properties['Student ID'] && properties['Student ID']?.title[0] ? Number(properties['Student ID']?.title[0].plain_text) : '',
    };
  });

  return students;
};

const composeStudentsWithHardSkills = async (env, students) => {
  const composedStudents = students.map(async (student) => {
    const { hardSkillsRelation = [], id } = student;
    if (isEmpty(hardSkillsRelation)) return student;

    const filter = {
      or: [
        {
          property: 'Student ID',
          title: {
            equals: id.toString(),
          },
        },
      ],
    };

    const skillResults = await queryNotionDatabase(env.NOTION_KEY, env.HYPER_NETWORK_HARD_SKILLS_DATABASE_ID, filter);

    const hardSkills = skillResults.results.map(({ properties }) => ({
      skill: properties['Skill']?.select ? properties['Skill']?.select.name : '',
      comment:
        properties['Comment']?.rich_text && properties['Comment']?.rich_text[0] ? properties['Comment']?.rich_text[0].plain_text : '',
    }));

    return {
      ...student,
      hardSkills,
    };
  });
  return Promise.all(composedStudents);
};

const composeStudentsWithContact = async (env, students) => {
  const composedStudents = students.map(async (student) => {
    const { hardSkillsRelation = [], id } = student;
    if (isEmpty(hardSkillsRelation)) return student;

    const filter = {
      or: [
        {
          property: 'Student ID',
          title: {
            equals: id.toString(),
          },
        },
      ],
    };

    const contactResult = await queryNotionDatabase(env.NOTION_KEY, env.HYPER_NETWORK_CONTACTS_DATABASE_ID, filter);

    const contact = contactResult.results.reduce((map, { properties }) => {
      const slackId =
        properties['Slack Member ID']?.rich_text && properties['Slack Member ID']?.rich_text[0]
          ? properties['Slack Member ID']?.rich_text[0].plain_text
          : '';
      return {
        email: properties['Email']?.email ? properties['Email']?.email : '',
        linkedin: properties['LinkedIn']?.url ? properties['LinkedIn']?.url : '',
        slack: {
          ...(slackId
            ? {
                checked: true,
                memberId: slackId,
              }
            : { checked: false, slackId: '' }),
        },
      };
    }, {});

    return {
      ...student,
      contact,
    };
  });
  return Promise.all(composedStudents);
};

const convertToStudentView = (composedStudents) => {
  const propertiesToOmit = ['contactRelation', 'hardSkillsRelation'];
  const results = composedStudents.map((student) => omit(propertiesToOmit, student));
  return results;
};

const convertNameQueryToNotionFilters = ({ name }) => {
  if (isEmpty(name)) {
    return [];
  }

  const names = compact(name.split(' '));
  const filter = names.flatMap((name) => {
    return [
      {
        property: 'First Name',
        rich_text: {
          contains: name,
        },
      },
      {
        property: 'Last Name',
        rich_text: {
          contains: name,
        },
      },
    ];
  });

  return filter;
};

const convertHardSkillQueryToNotionFilters = ({ hardSkills = [] }) => {
  if (isEmpty(hardSkills)) {
    return [];
  }

  const filter = hardSkills.flatMap((hardSkill) => {
    return [
      {
        property: 'Skills',
        multi_select: {
          contains: hardSkill,
        },
      },
    ];
  });

  return filter;
};

const convertQueryToNotionFilters = async (env, parameters) => {
  const nameFilters = convertNameQueryToNotionFilters(parameters);
  const hardSkillFilters = convertHardSkillQueryToNotionFilters(parameters);
  const programFilters = convertProgramsQueryToNotionFilters(parameters);
  const languageFilters = convertLanguagesQueryToNotionFilters(parameters);

  const filter = {
    and: compact([
      nameFilters.length || programFilters.length
        ? {
            or: [...nameFilters, ...programFilters],
          }
        : undefined,
      ...hardSkillFilters,
      ...languageFilters,
    ]),
  };
  return filter;
};

export default async (request, env, ctx) => {
  const parameters = await request.json();

  const filter = await convertQueryToNotionFilters(env, parameters);
  if (isEmpty(filter.and)) return new Response(JSON.stringify([]));

  const hyperNetworkResults = await queryNotionDatabase(env.NOTION_KEY, env.HYPER_NETWORK_DATABASE_ID, filter);

  const students = convertHyperNetworkResultsToStudents(hyperNetworkResults);
  const studentsWithHardSkills = await composeStudentsWithHardSkills(env, students);
  const studentsWithContact = await composeStudentsWithContact(env, studentsWithHardSkills);
  const viewableStudents = convertToStudentView(studentsWithContact);

  return new Response(JSON.stringify(viewableStudents));
};
