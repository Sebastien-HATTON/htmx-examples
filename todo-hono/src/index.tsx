import {Database} from 'bun:sqlite';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {serveStatic} from 'hono/bun';
import type {FC} from 'hono/jsx';
import WebSocket from 'ws';
import {z} from 'zod';
import {zValidator} from '@hono/zod-validator';

const app = new Hono();

// This serves static files from the public directory.
app.use('/*', serveStatic({root: './public'}));

const Layout: FC = ({children}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>To Do List</title>
      <link rel="stylesheet" href="/styles.css" />
      <script src="htmx.min.js"></script>
      <script src="alpine.min.js"></script>
      <script defer src="setup.js"></script>
    </head>
    <body>{children}</body>
  </html>
);

// Prepare to use SQLite to store todos.
const db = new Database('todos.db', {create: true});
const deleteTodoPS = db.query('delete from todos where id = ?');
const getAllTodosQuery = db.query('select * from todos order by description;');
const getTodoQuery = db.query('select * from todos where id = ?');
const insertTodoQuery = db.query(
  'insert into todos (description, completed) values (?, 0) returning id'
);
const updateTodoPS = db.prepare('update todos set completed=? where id = ?');

type Todo = {
  id: number;
  description: string;
  completed: number; // 0 or 1 for SQLite compatibility
};

function addTodo(description: string) {
  try {
    const {id} = insertTodoQuery.get(description) as {id: number};
    return {id, description, completed: 0};
  } catch (e) {
    const isDuplicate = e.toString().includes('UNIQUE constraint failed');
    throw isDuplicate ? new Error(`duplicate todo "${description}"`) : e;
  }
}

type TodoItemProps = {todo: Todo};
function TodoForm() {
  // We are using attribute spreading to add this attribute to the form
  // because VS Code does not recognize hx-on:htmx:after-request
  // as a valid attribute name.
  const reset = {'hx-on:htmx:after-request': 'this.reset()'};
  return (
    <form
      hx-disabled-elt="#add-btn"
      hx-indicator=".htmx-indicator"
      hx-post="/todos"
      hx-swap="afterbegin"
      hx-target="#todo-list"
      {...reset}
    >
      <input
        class="border border-gray-500 p-1 rounded-lg"
        hx-on:input="document.getElementById('add-btn').disabled = this.value === ''"
        name="description"
        placeholder="enter new todo here"
        size={30}
      />
      <button disabled id="add-btn" type="submit">
        Add
      </button>
      <img alt="loading..." class="htmx-indicator" src="spinner.gif" />
    </form>
  );
}

function TodoItem({todo: {completed, description, id}}: TodoItemProps) {
  return (
    <div class="todo-item" x-data={`{id: ${id}}`}>
      <input
        type="checkbox"
        checked={completed === 1}
        hx-patch={`/todos/${id}/toggle-complete`}
        hx-target="closest div"
        hx-swap="outerHTML"
      />
      <div
        class={completed === 1 ? 'completed' : ''}
        id={`todo-${id}`}
        x-on:click="editingId = id"
        x-show="id !== editingId"
      >
        {description}
      </div>
      <input
        id={`todo-input-${id}`}
        type="text"
        value={description}
        x-show="id === editingId"
      />
      <button
        class="plain"
        hx-confirm="Are you sure?"
        hx-delete={`/todos/${id}`}
        hx-swap="outerHTML swap:1s"
        hx-target="closest div"
      >
        🗑
      </button>
    </div>
  );
}

type TodoListProps = {todos: Todo[]};

function TodoList({todos}: TodoListProps) {
  console.log('index.tsx : todos =', todos);
  return (
    <div id="todo-list" x-data="{editingId: 0}">
      {todos.map(todo => (
        <TodoItem todo={todo} />
      ))}
    </div>
  );
}

const idSchema = z.object({
  id: z.coerce.number().positive()
});
const idValidator = zValidator('param', idSchema);

// This deletes a given todo.  It is the D in CRUD.
app.delete('/todos/:id', idValidator, (c: Context) => {
  const id = c.req.param('id');
  deleteTodoPS.get(id);
  c.header('HX-Trigger', 'status-change');
  // By not returning any HTML for this todo item,
  // we replace the existing todo item with nothing.

  // This can be used to demonstrate fading new content into view.
  // return <div class="todo-item warning">A todo was deleted.</div>;
  return c.text('');
});

app.get('/', (c: Context) => c.redirect('/todos'));

app.get('/todos/status', (c: Context) => {
  const todos = getAllTodosQuery.all() as Todo[];
  const uncompletedCount = todos.filter(todo => !todo.completed).length;
  return c.text(`${uncompletedCount} of ${todos.length} remaining`);
});

// This renders the todo list UI.  It is the R in CRUD.
app.get('/todos', (c: Context) => {
  const todos = getAllTodosQuery.all();

  return c.html(
    <Layout>
      <h1>To Do List</h1>
      <p hx-get="/todos/status" hx-trigger="load, status-change from:body" />
      <p id="error" />
      <TodoForm />
      <TodoList todos={todos} />
    </Layout>
  );
});

// This toggles the completed state of a given todo.  It is the U in CRUD.
app.patch('/todos/:id/toggle-complete', idValidator, (c: Context) => {
  const id = c.req.param('id');
  const todo = getTodoQuery.get(id) as Todo;
  if (todo) {
    todo.completed = 1 - todo.completed;
    updateTodoPS.run(todo.completed, todo.id);
    c.header('HX-Trigger', 'status-change');
    return c.html(<TodoItem todo={todo} />);
  } else {
    return c.notFound();
  }
});

const todoSchema = z
  .object({
    description: z.string().min(1)
  })
  .strict(); // no extra properties allowed
const todoValidator = zValidator('form', todoSchema);

// This adds a new todo.  It is the C in CRUD.
app.post('/todos', todoValidator, async (c: Context) => {
  const formData = await c.req.formData();
  const description = formData?.get('description') as string | null;
  if (!description || description.length === 0) {
    throw new Error('Todo description cannot be empty');
  }
  try {
    const todo = addTodo(description);
    Bun.sleepSync(1000); // enables testing hx-indicator spinner
    c.header('HX-Trigger', 'status-change');
    return c.html(
      <>
        <TodoItem todo={todo} />
        {/* Clear previous error message. */}
        <p id="error" hx-swap-oob="true" />
      </>
    );
  } catch (e) {
    return c.html(
      <p id="error" hx-swap-oob="true">
        {e.message}
      </p>
    );
  }
});

// The browser code connects to this
// so it can detect when the server is restarted.
// On restart, the browser reloads the page.
new WebSocket.Server({port: 3001});

export default app;
