-- The first 19 towns. Coordinates come from GeoNames, except Cape Vidal.
-- Add new towns on the website's Manage towns page, not here.
insert into public.towns (name, province, lat, lon) values
  ('Ballito',      'KwaZulu-Natal', -29.5390, 31.2144),
  ('Cape Vidal',   'KwaZulu-Natal', -28.1261, 32.5577),
  ('Ladysmith',    'KwaZulu-Natal', -28.5587, 29.7790),
  ('Harrismith',   'Free State',    -28.2728, 29.1295),
  ('Bethlehem',    'Free State',    -28.2308, 28.3071),
  ('Marquard',     'Free State',    -28.6645, 27.4305),
  ('Bloemfontein', 'Free State',    -29.1211, 26.2140),
  ('Villiers',     'Free State',    -27.0303, 28.6006),
  ('Frankfort',    'Free State',    -27.2789, 28.4970),
  ('Bothaville',   'Free State',    -27.3887, 26.6170),
  ('Klerksdorp',   'North West',    -26.8521, 26.6667),
  ('Lichtenburg',  'North West',    -26.1520, 26.1597),
  ('Wellington',   'Western Cape',  -33.6398, 19.0112),
  ('Moorreesburg', 'Western Cape',  -33.1539, 18.6603),
  ('George',       'Western Cape',  -33.9630, 22.4617),
  ('Caledon',      'Western Cape',  -34.2300, 19.4265),
  ('Swellendam',   'Western Cape',  -34.0226, 20.4417),
  ('Bredasdorp',   'Western Cape',  -34.5322, 20.0403),
  ('Heidelberg',   'Western Cape',  -34.0913, 20.9566);
