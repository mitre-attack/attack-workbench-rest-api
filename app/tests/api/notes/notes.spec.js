const request = require('supertest');
const { expect } = require('expect');

const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');

const config = require('../../../config/config');
const login = require('../../shared/login');
const { cloneForCreate } = require('../../shared/clone-for-create');

const logger = require('../../../lib/logger');
logger.level = 'debug';

// modified and created properties will be set before calling REST API
// stix.id property will be created by REST API
const initialObjectData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    spec_version: '2.1',
    type: 'note',
    abstract: 'This is the abstract for a note. Ivory.',
    content: 'This is the content for a note.',
    authors: ['Author 1', 'Author 2'],
    external_references: [{ source_name: 'source-1', external_id: 's1' }],
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--6444f546-6900-4456-b3b1-015c88d70dab',
    object_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
  },
};

describe('Notes API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/notes should return an empty array of notes', async function () {
    const res = await request(app)
      .get('/api/notes')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(0);
  });

  it('POST /api/notes should not create an empty note', async function () {
    const body = {};
    await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(400);
  });

  let note1;
  it('POST /api/notes should create a note', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.stix.created = timestamp;
    initialObjectData.stix.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created note
    note1 = res.body;
    expect(note1).toBeDefined();
    expect(note1.stix).toBeDefined();
    expect(note1.stix.id).toBeDefined();
    expect(note1.stix.created).toBeDefined();
    expect(note1.stix.modified).toBeDefined();
    expect(note1.stix.x_mitre_attack_spec_version).toBe(config.app.attackSpecVersion);
  });

  it('GET /api/notes should return the added note', async function () {
    const res = await request(app)
      .get('/api/notes')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one note in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(1);
  });

  it('GET /api/notes can use the lastUpdatedBy parameter to return the note(s), if any, which were created by a certain user (expect 0 > for anonymous user)', async function () {
    const res = await request(app)
      .get(`/api/notes?lastUpdatedBy=${note1.workspace.workflow.created_by_user_account}`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Only 1 note created by this user
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(1);
  });

  it('GET /api/notes can use the lastUpdatedBy parameter to return note(s), if any, which were created by a certain user (expect 0 for a fake user)', async function () {
    const res = await request(app)
      .get(`/api/notes?lastUpdatedBy=identity--11111111-1111-1111-1111-111111111111`)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // Expect no notes to be created by this user
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(0);
  });

  it('GET /api/notes/:id should not return a note when the id cannot be found', async function () {
    await request(app)
      .get('/api/notes/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/notes/:id should return the added note', async function () {
    const res = await request(app)
      .get('/api/notes/' + note1.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one note in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(1);

    const note = notes[0];
    expect(note).toBeDefined();
    expect(note.stix).toBeDefined();
    expect(note.stix.id).toBe(note1.stix.id);
    expect(note.stix.type).toBe(note1.stix.type);
    expect(note.stix.abstract).toBe(note1.stix.abstract);
    expect(note.stix.content).toBe(note1.stix.content);
    expect(note.stix.spec_version).toBe(note1.stix.spec_version);
    expect(note.stix.object_refs).toEqual(expect.arrayContaining(note1.stix.object_refs));
    expect(note.stix.created_by_ref).toBe(note1.stix.created_by_ref);
    expect(note.stix.x_mitre_attack_spec_version).toBe(note1.stix.x_mitre_attack_spec_version);
  });

  it('PUT /api/notes should update a note', async function () {
    const originalModified = note1.stix.modified;
    const timestamp = new Date().toISOString();
    note1.stix.modified = timestamp;
    note1.stix.description = 'This is an updated note.';
    const body = note1;
    const res = await request(app)
      .put('/api/notes/' + note1.stix.id + '/modified/' + originalModified)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated note
    const note = res.body;
    expect(note).toBeDefined();
    expect(note.stix.id).toBe(note1.stix.id);
    expect(note.stix.modified).toBe(note1.stix.modified);
  });

  it('POST /api/notes should not create a note with the same id and modified date', async function () {
    const body = note1;
    await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(409);
  });

  let note2;
  it('POST /api/notes should create a new version of a note with a duplicate stix.id but different stix.modified date', async function () {
    note2 = cloneForCreate(note1);
    const timestamp = new Date().toISOString();
    note2.stix.abstract = 'This is the abstract for a note.';
    note2.stix.content = 'Still a note. Parchment.';
    note2.stix.modified = timestamp;
    const body = note2;
    const res = await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created note
    note2 = res.body;
    expect(note2).toBeDefined();
  });

  it('GET /api/notes should return the latest added note', async function () {
    const res = await request(app)
      .get('/api/notes/' + note2.stix.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one note in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(1);
    const note = notes[0];
    expect(note.stix.id).toBe(note2.stix.id);
    expect(note.stix.modified).toBe(note2.stix.modified);
  });

  let note3;
  it('POST /api/notes should create a new note with a new stix.id', async function () {
    note3 = cloneForCreate(note1);
    note3.stix.id = undefined;
    const timestamp = new Date().toISOString();
    note3.stix.abstract = 'This is the abstract for a note.';
    note3.stix.content = 'Still a note.';
    note3.stix.modified = timestamp;
    const body = note3;
    const res = await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created note
    note3 = res.body;
    expect(note3).toBeDefined();
  });

  let note4;
  it('POST /api/notes should create a new version of the last note with a duplicate stix.id but different stix.modified date', async function () {
    note4 = cloneForCreate(note3);
    const timestamp = new Date().toISOString();
    note4.stix.abstract = 'This is the abstract for a note. Parchment';
    note4.stix.content = 'Still a note.';
    note4.stix.modified = timestamp;
    const body = note4;
    const res = await request(app)
      .post('/api/notes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created note
    note4 = res.body;
    expect(note4).toBeDefined();
  });

  it('GET /api/notes/:id should return all versions of the first note', async function () {
    const res = await request(app)
      .get('/api/notes/' + note1.stix.id + '?versions=all')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two notes in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(2);
  });

  it('GET /api/notes/:id/modified/:modified should return the first added note', async function () {
    const res = await request(app)
      .get('/api/notes/' + note1.stix.id + '/modified/' + note1.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one note in an array
    const note = res.body;
    expect(note).toBeDefined();
    expect(note.stix).toBeDefined();
    expect(note.stix.id).toBe(note1.stix.id);
    expect(note.stix.modified).toBe(note1.stix.modified);
  });

  it('GET /api/notes/:id/modified/:modified should return the second added note', async function () {
    const res = await request(app)
      .get('/api/notes/' + note2.stix.id + '/modified/' + note2.stix.modified)
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one note in an array
    const note = res.body;
    expect(note).toBeDefined();
    expect(note.stix).toBeDefined();
    expect(note.stix.id).toBe(note2.stix.id);
    expect(note.stix.modified).toBe(note2.stix.modified);
  });

  it('GET /api/notes should return the latest version of all the notes', async function () {
    const res = await request(app)
      .get('/api/notes/')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two notes in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(2);
  });

  it('GET /api/notes uses the search parameter to return the latest version of both notes', async function () {
    const res = await request(app)
      .get('/api/notes?search=PARCHMENT')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get two notes in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(2);
  });

  it('GET /api/notes should not get the first version of the note when using the search parameter', async function () {
    const res = await request(app)
      .get('/api/notes?search=IVORY')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get zero notes in an array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(0);
  });

  it('DELETE /api/notes/:id should not delete a note when the id cannot be found', async function () {
    await request(app)
      .delete('/api/notes/not-an-id')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(404);
  });

  it('DELETE /api/notes/:id/modified/:modified should delete the first version of the note', async function () {
    await request(app)
      .delete('/api/notes/' + note1.stix.id + '/modified/' + note1.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/notes/:id/modified/:modified should delete the second version of the note', async function () {
    await request(app)
      .delete('/api/notes/' + note2.stix.id + '/modified/' + note2.stix.modified)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('DELETE /api/notes/:id should delete all versions of the note', async function () {
    await request(app)
      .delete('/api/notes/' + note3.stix.id)
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/notes should return an empty array of notes', async function () {
    const res = await request(app)
      .get('/api/notes')
      .set('Accept', 'application/json')
      .set('Cookie', `${passportCookie.name}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const notes = res.body;
    expect(notes).toBeDefined();
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
