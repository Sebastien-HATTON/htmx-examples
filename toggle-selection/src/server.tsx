import {Context, Hono} from 'hono';
import {serveStatic} from 'hono/bun';
import './reload-server.ts';

const app = new Hono();

// This serves static files from the public directory.
app.use('/*', serveStatic({root: './public'}));

const dogs = ['Comet', 'Maisey', 'Oscar', 'Ramsay'];

// This holds the name of the one selected dog.
let selectedName = '';

type DogProps = {name: string; toggle?: boolean};
function Dog({name, toggle}: DogProps) {
  const classes = 'dog' + (name === selectedName ? ' selected' : '');
  const attrs = toggle ? {'hx-swap': 'none', 'hx-swap-oob': 'true'} : {};
  return (
    <div
      class={classes}
      hx-get={`/toggle/${name}`}
      hx-trigger="click"
      id={name}
      {...attrs}
    >
      {name}
    </div>
  );
}

app.get('/dogs', (c: Context) =>
  c.html(
    <>
      {dogs.map(dog => (
        <Dog name={dog} />
      ))}
    </>
  )
);

app.get('/toggle/:name', (c: Context) => {
  const name = c.req.param('name');
  console.log('server.tsx toggle: name =', name);
  const previousDog = selectedName ? <Dog name={selectedName} toggle /> : null;
  const thisDog = <Dog name={name} toggle />;
  selectedName = name === selectedName ? '' : name;

  // If a dog was previously selected, two Dog components are returned.
  // Otherwise only one is returned.
  // Both will have hx-swap-oob set to true.
  return c.html(
    <>
      {previousDog}
      {thisDog}
    </>
  );
});

export default app;