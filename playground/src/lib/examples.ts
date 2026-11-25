// Each example is a pipeline that SQL would run without complaint, and the
// corrected version. Sources sit below the pipeline; Quern hoists them.

export const SOURCES = `
source customers from "data/customers.csv" {
  customer_id:  int key,
  name:         text pii,
  email:        text pii,
  region:       text,
  credit_limit: float<USD>,
}

source orders from "data/orders.csv" {
  order_id:    int key,
  customer_id: int,
  placed_on:   date,
  amount:      float<USD>,
  discount:    float<USD>?,
  shipped:     bool,
}

source order_items from "data/order_items.csv" {
  order_id:   int,
  line_no:    int,
  product_id: int,
  quantity:   int,
  key (order_id, line_no),
}

source products from "data/products.csv" {
  product_id: int key,
  title:      text,
  price:      float<USD>,
  weight:     int<g>?,
}
`;

export interface Example {
  id: string;
  label: string;
  /** What goes wrong when the same query is written in SQL. */
  inSql: string;
  broken: string;
  fixed: string;
}

const program = (comment: string, body: string): string => `-- ${comment}\n${body.trim()}\n${SOURCES}`;

export const EXAMPLES: Example[] = [
  {
    id: 'fan-trap',
    label: 'Double-counted total',
    inSql: 'SQL returns a total. Each credit limit is counted once per order, so the total is too high.',
    broken: program(
      'Total credit limit per region. Looks right. It is not.',
      `
pipeline credit_exposure {
  from orders
  join customers on customer_id = customers.customer_id
  group by region { exposure = sum(credit_limit) }
}`,
    ),
    fixed: program(
      'One row per customer, so each limit is counted once.',
      `
pipeline credit_exposure {
  from customers
  group by region { exposure = sum(credit_limit) }
}`,
    ),
  },
  {
    id: 'nulls',
    label: 'Vanishing rows',
    inSql: 'SQL returns no rows at all. An order with no discount has null there, and null = 0 is not true.',
    broken: program(
      'Orders sold at full price.',
      `
pipeline full_price_orders {
  from orders
  where discount = 0 USD
  select order_id, amount
}`,
    ),
    fixed: program(
      'No discount counts as a discount of zero.',
      `
pipeline full_price_orders {
  from orders
  where discount ?? 0 USD = 0 USD
  select order_id, amount
}`,
    ),
  },
  {
    id: 'units',
    label: 'Dollars plus grams',
    inSql: 'SQL adds the two numbers. The result is a price in dollars plus a weight in grams.',
    broken: program(
      'A shipping estimate per order line.',
      `
pipeline shipping_estimate {
  from order_items
  join products on product_id = products.product_id
  let estimate = price + weight ?? 0 g
  select order_id, line_no, estimate
}`,
    ),
    fixed: program(
      'Weight is turned into dollars at a stated rate first.',
      `
pipeline shipping_estimate {
  from order_items
  join products on product_id = products.product_id
  let freight = convert(weight ?? 0 g, USD, 0.004)
  let estimate = price + freight
  select order_id, line_no, estimate
}`,
    ),
  },
  {
    id: 'pii',
    label: 'Leaked email',
    inSql: 'SQL writes the file. Customer email addresses are now in a public export.',
    broken: program(
      'A customer list for the public data portal.',
      `
pipeline mailing_list {
  from customers
  select customer_id, email, region
}

publish mailing_list to public "out/mailing_list.csv"`,
    ),
    fixed: program(
      'The address is hashed, which is the one way it may leave.',
      `
pipeline mailing_list {
  from customers
  select customer_id, contact = hash(email), region
}

publish mailing_list to public "out/mailing_list.csv"`,
    ),
  },
  {
    id: 'fan-out',
    label: 'Multiplying join',
    inSql: 'SQL returns a total. An order with three lines has its amount added three times.',
    broken: program(
      'What each customer has spent.',
      `
pipeline customer_spend {
  from orders
  join order_items on order_id = order_items.order_id
  group by customer_id { spent = sum(amount) }
}`,
    ),
    fixed: program(
      'Orders are already one row each. The join was the bug.',
      `
pipeline customer_spend {
  from orders
  group by customer_id { spent = sum(amount), orders = count() }
}`,
    ),
  },
];

export const CLEAN: string = program(
  'A correct program. Edit anything and the checker follows along.',
  `
pipeline shipped_orders {
  from orders
  where shipped and placed_on >= @2026-10-01
  let net = amount - discount ?? 0 USD
}

pipeline revenue_by_region {
  from shipped_orders
  join customers on customer_id = customers.customer_id
  group by region {
    revenue = sum(net),
    orders  = count(),
  }
  order by revenue desc
}

pipeline top_products {
  from order_items
  join products on product_id = products.product_id
  let line_total = quantity * price
  group by product_id, title {
    units = sum(quantity),
    sales = sum(line_total),
  }
  order by sales desc, product_id
  limit 3
}`,
);
