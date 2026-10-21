# MediCarePLC Backend API

TypeScript and Express REST API for MediCarePLC's product catalogue, customer accounts, carts, orders, and sales operations. PostgreSQL data access is implemented with Prisma; Redis supports caching, rate limiting, and token revocation; product images use Supabase Storage.

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Architecture and project structure](#architecture-and-project-structure)
- [Authentication and security](#authentication-and-security)
- [API reference](#api-reference)
- [Database](#database)
- [Caching and Redis](#caching-and-redis)
- [Environment variables](#environment-variables)
- [Prerequisites](#prerequisites)
- [Local setup and development](#local-setup-and-development)
- [Docker](#docker)
- [Errors and logging](#errors-and-logging)
- [Testing](#testing)
- [Deployment notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

The service is a modular REST API for an online pharmacy-oriented catalogue and order workflow. Customers can register (subject to administrator approval), browse products, manage addresses and carts, place and view orders, and receive in-app notifications. Administrators manage catalogue data, approve users, update orders and payments, and view sales and TSR reporting. TSR accounts can view and update orders in their assigned geographic territory.

The server listens on `PORT` (default `3000`). The root endpoint (`GET /`) returns a basic server status response. There is no API version negotiation or generated OpenAPI/Swagger specification in the repository.

## Features

- Customer registration and login with email or phone number; registration creates a pending customer account and a cart.
- Admin approval of accounts and promotion of customers to TSR role.
- Profile, password, address, and notification management.
- Product and category browsing, search, pricing/discount calculations, stock administration, and image management.
- Cart management and transactional order creation with stock decrement, cart clearing, and order notification.
- Cash-on-delivery payment records and administrator payment confirmation.
- Admin sales summaries and territory-based TSR order and sales reports.
- Redis-backed route caching, selected product-list caches, cache-tag invalidation, request throttling for login and registration, and JWT revocation on logout.
- Dockerfile and Docker Compose configuration for a containerized app with Redis.

## Technology stack

| Area                 | Technology                                       | Usage in this repository                              |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Runtime and language | Node.js 20 (Docker image), TypeScript            | Application runtime and source language               |
| HTTP server          | Express 4                                        | REST routes, JSON parsing, and middleware             |
| Database             | PostgreSQL                                       | Persistent application data                           |
| ORM                  | Prisma Client                                    | Database queries and schema in `prisma/schema.prisma` |
| Authentication       | `jsonwebtoken`, `bcryptjs`                       | 30-day JWTs and password hashing                      |
| Validation           | `express-validator` plus controller-level checks | Registration, login, and selected product fields      |
| Cache and rate limit | Redis via `ioredis`                              | Route/product caching, throttling, and JWT blacklist  |
| Image storage        | Supabase Storage via `@supabase/supabase-js`     | Product image upload and removal                      |
| Upload parsing       | Multer                                           | In-memory multipart image uploads                     |
| Development          | `ts-node`, `nodemon`                             | Restart-on-change development server                  |
| Containerization     | Docker, Docker Compose                           | App image and local Redis service                     |

Supabase Auth is not used for login; the application implements its own JWT authentication. There is no separate logging framework, test framework, API-documentation generator, job queue, scheduler, or monitoring integration configured in the repository.

## Architecture and project structure

The code follows a route → middleware → controller → service/Prisma pattern. Prisma access is exported from `src/config/supabase.ts`; despite that filename, it configures Prisma and does not create a Supabase database client. The Supabase client is configured in `src/services/image.service.ts` for Storage operations.

```text
medicare-server/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── admin-tsr-sales/
│   │   ├── admin-tsr-sales.controller.ts
│   │   ├── admin-tsr-sales.routes.ts
│   │   ├── admin-tsr-sales.service.ts
│   │   └── admin-tsr-sales.validation.ts
│   ├── config/
│   │   ├── redis.ts
│   │   └── supabase.ts
│   ├── controllers/
│   │   ├── cart.controller.ts
│   │   ├── category.controller.ts
│   │   ├── order.controller.ts
│   │   ├── product.controller.ts
│   │   ├── sales.controller.ts
│   │   └── user.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── cache.middleware.ts
│   │   ├── rate-limit.middleware.ts
│   │   └── upload.middleware.ts
│   ├── routes/
│   │   ├── category.routes.ts
│   │   ├── distributor.routes.ts
│   │   ├── order.routes.ts
│   │   ├── product.routes.ts
│   │   ├── sales.routes.ts
│   │   └── user.routes.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── cache.service.ts
│   │   ├── discount.service.ts
│   │   ├── image.service.ts
│   │   ├── product.service.ts
│   │   └── sales.service.ts
│   ├── tsr/
│   │   ├── tsr.controller.ts
│   │   ├── tsr.middleware.ts
│   │   ├── tsr.routes.ts
│   │   ├── tsr.service.ts
│   │   └── tsr.validation.ts
│   ├── types/
│   │   └── index.ts
│   ├── validators/
│   │   ├── auth.validator.ts
│   │   └── product.validator.ts
│   └── index.ts
├── .dockerignore
├── .gitignore
├── .vscode/
│   └── settings.json
├── Dockerfile
├── docker-compose.yml
├── nodemon.json
├── package-lock.json
├── package.json
├── prisma.config.ts
├── readme.MD
└── tsconfig.json
```

`src/index.ts` configures Express, mounts route groups, starts Redis, and listens for HTTP requests. The controllers contain request and response handling; services hold authentication, discount, image, product-cache, and sales logic. Routes under `src/tsr` and `src/admin-tsr-sales` implement territory and TSR reporting features. `prisma.config.ts` points Prisma at the schema and migration directory `prisma/migrations`; that migration directory is not present in the checked-in project tree.

## Authentication and security

- Send the JWT issued at login in the `Authorization` header using the `Bearer` scheme.
- Successful login issues a signed token containing the user's ID, email, role, and approval state. Tokens expire after 30 days.
- Passwords are hashed with `bcryptjs` using 10 rounds.
- Self-registration only allows the `customer` role. New accounts have `isApproved: false`; login is rejected until an administrator approves the account.
- `authenticateToken` verifies the token and checks Redis for a `blacklist:<token>` revocation key. Logout writes that key for 24 hours. There is no refresh-token endpoint.
- Admin routes check for the `admin` role. TSR routes check for the `TSR` role. Customer profile, address, cart, notification, and order routes require an approved account; TSR routes do not use the approved-account middleware.
- Registration and login use Redis rate limits: 5 registration requests per 900 seconds and 10 login requests per 300 seconds, keyed by request path and IP.
- Product image uploads accept JPEG/JPG, PNG, GIF, or WebP by extension and MIME type, with a 5 MiB per-file limit and up to 10 files in the `images` field.
- `cors()` is enabled without an explicit origin allowlist. No security-header middleware is configured in the application.

These are descriptions of implemented behavior, not a security certification. Configure secrets and network access appropriately before deployment. In particular, the service-role key grants privileged Storage access and must remain server-side. The blacklist TTL (24 hours) is shorter than the JWT lifetime (30 days), so revocation is not persistent for the full token lifetime.

## API reference

Base paths below are relative to the server origin, for example `http://localhost:3000`. Unless a row says otherwise, successful collection endpoints return JSON and paginated endpoints use `data.pagination`. Protected requests require the bearer authorization header described above. Error payloads are not fully uniform: some handlers return `{ success: false, error }`, while user/authentication handlers often return `{ error }`.

### Health

| Method | Path | Access | Purpose                                                       |
| ------ | ---- | ------ | ------------------------------------------------------------- |
| `GET`  | `/`  | Public | Returns `{ "status": "OK", "message": "Server is running" }`. |

### Users, accounts, addresses, notifications, and cart

Mount prefix: `/v1/users`.

| Method   | Path                                      | Access                          | Request/query fields and behavior                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/v1/users/register`                      | Public; rate limited            | JSON: `email`, `phone_number`, `password` required; optional `name`, `pharmacy_name`, `fullAddress`, `divisionId`, `districtId`, `upazilaId`, and `role` (`customer` only). Email, phone, password (minimum 6 characters), geographic UUIDs, and optional role are validated. Creates an unapproved customer and cart. |
| `POST`   | `/v1/users/login`                         | Public; rate limited            | JSON: `email` or `phone_number`, and `password`. Returns user data and JWT; pending accounts cannot log in.                                                                                                                                                                                                            |
| `POST`   | `/v1/users/logout`                        | Authenticated                   | Revokes the presented token in Redis for 24 hours.                                                                                                                                                                                                                                                                     |
| `GET`    | `/v1/users/profile`                       | Approved user                   | Returns profile, geographic data, addresses, and up to 10 unread notifications.                                                                                                                                                                                                                                        |
| `PUT`    | `/v1/users/profile`                       | Approved user                   | Optional JSON fields: `name`, `pharmacy_name`, `phone_number`, `fullAddress`, `divisionId`, `districtId`, `upazilaId`.                                                                                                                                                                                                 |
| `POST`   | `/v1/users/change-password`               | Approved user                   | JSON: `oldPassword`, `newPassword`.                                                                                                                                                                                                                                                                                    |
| `GET`    | `/v1/users/addresses`                     | Approved user                   | Lists the current user's addresses.                                                                                                                                                                                                                                                                                    |
| `POST`   | `/v1/users/addresses`                     | Approved user                   | JSON requires `street`, `city`, `country`; optional `state`, `postalCode`, `isDefault`. First address is made default automatically.                                                                                                                                                                                   |
| `PUT`    | `/v1/users/addresses/:addressId`          | Approved user; own address      | Updates any supplied address fields: `street`, `city`, `state`, `postalCode`, `country`, `isDefault`.                                                                                                                                                                                                                  |
| `PUT`    | `/v1/users/addresses/:addressId/default`  | Approved user; own address      | Makes the address the user's default address.                                                                                                                                                                                                                                                                          |
| `DELETE` | `/v1/users/addresses/:addressId`          | Approved user; own address      | Deletes an address unless it is already used by an order.                                                                                                                                                                                                                                                              |
| `GET`    | `/v1/users/all`                           | Admin                           | Lists users. Query: `page` (default 1), `limit` (default 20), `role` (`admin`, `customer`, or `TSR`), `isApproved` (`true`/`false`), `search` (email or phone).                                                                                                                                                        |
| `PUT`    | `/v1/users/approve/:userId`               | Admin                           | Approves a user and creates an approval notification.                                                                                                                                                                                                                                                                  |
| `PATCH`  | `/v1/users/:userId/role`                  | Admin                           | JSON: `{ "role": "TSR" }`. Promotes a customer to TSR; it does not assign territory fields.                                                                                                                                                                                                                            |
| `DELETE` | `/v1/users/:userId`                       | Admin                           | Deletes the specified user.                                                                                                                                                                                                                                                                                            |
| `POST`   | `/v1/users/notifications/send`            | Admin                           | JSON: `userId`, `title`, `message`, `type` (`order`, `approval`, or `system`).                                                                                                                                                                                                                                         |
| `POST`   | `/v1/users/notifications/send-bulk`       | Admin                           | JSON: non-empty `userIds` array, `title`, `message`, `type` (`order`, `approval`, or `system`).                                                                                                                                                                                                                        |
| `GET`    | `/v1/users/notifications`                 | Approved user                   | Query: `unreadOnly=true`, `page` (default 1), `limit` (default 20).                                                                                                                                                                                                                                                    |
| `PUT`    | `/v1/users/notifications/read-all`        | Approved user                   | Marks all current user's notifications as read.                                                                                                                                                                                                                                                                        |
| `PUT`    | `/v1/users/notifications/:notificationId` | Approved user; own notification | Marks a notification as read.                                                                                                                                                                                                                                                                                          |
| `GET`    | `/v1/users/cart`                          | Approved user                   | Returns cart items, calculated item prices, subtotal, savings, total, and quantity count.                                                                                                                                                                                                                              |
| `GET`    | `/v1/users/cart/count`                    | Approved user                   | Returns summed quantity as `data.count`.                                                                                                                                                                                                                                                                               |
| `POST`   | `/v1/users/cart/add`                      | Approved user                   | JSON: `productId`, `quantity`; adds the requested quantity to any existing cart item.                                                                                                                                                                                                                                  |
| `PUT`    | `/v1/users/cart/item/:itemId`             | Approved user; own cart item    | JSON: `quantity`; checks current stock.                                                                                                                                                                                                                                                                                |
| `DELETE` | `/v1/users/cart/item/:itemId`             | Approved user; own cart item    | Removes the item.                                                                                                                                                                                                                                                                                                      |
| `DELETE` | `/v1/users/cart/clear`                    | Approved user                   | Removes all items from the current user's cart.                                                                                                                                                                                                                                                                        |

The response envelope depends on the handler. For example, product lists use `{ "success": true, "data": { "products": [], "pagination": {} } }`; profile and account endpoints commonly use `{ "message": "...", "data": ... }`.

### Categories and distributors

Categories mount at `/v1/categories`. Distributor routes mount at `/v1`; the implemented route spelling is `/dristributors` (including the misspelling).

| Method   | Path                             | Access | Request/query fields and behavior                                           |
| -------- | -------------------------------- | ------ | --------------------------------------------------------------------------- |
| `GET`    | `/v1/categories`                 | Public | Lists categories alphabetically with product counts.                        |
| `GET`    | `/v1/categories/:id`             | Public | Category details with up to 20 latest in-stock products.                    |
| `GET`    | `/v1/categories/:id/products`    | Public | In-stock category products; query `page` (default 1), `limit` (default 20). |
| `POST`   | `/v1/categories`                 | Admin  | JSON: required `name`, optional `description`.                              |
| `PUT`    | `/v1/categories/:id`             | Admin  | JSON: optional `name`, `description`.                                       |
| `DELETE` | `/v1/categories/:id`             | Admin  | Fails if products still use the category.                                   |
| `GET`    | `/v1/dristributors`              | Admin  | Lists distributors alphabetically.                                          |
| `POST`   | `/v1/dristributors`              | Admin  | JSON allows only a non-empty `name`.                                        |
| `GET`    | `/v1/dristributors/:id`          | Admin  | Gets one distributor.                                                       |
| `GET`    | `/v1/dristributors/:id/products` | Admin  | Distributor products; query `page` (default 1), `limit` (default 20).       |
| `PATCH`  | `/v1/dristributors/:id`          | Admin  | JSON allows only a non-empty `name`.                                        |
| `DELETE` | `/v1/dristributors/:id`          | Admin  | Fails if products still reference the distributor.                          |

### Products and stock

Mount prefix: `/v1/products`. Public product results include price fields computed by the discount service (`finalPrice`, `savings`, and in many list/detail responses `discountBadge`).

| Method   | Path                                              | Access | Request/query fields and behavior                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/v1/products`                                    | Public | Query: `page` (1), `limit` (20), `categoryId`, `minPrice`, `maxPrice`, `sortBy` (default `createdAt`), `sortOrder` (default `desc`), `onSale=true`, `inStock=true`. Returns products and pagination.                                                                                                                                  |
| `GET`    | `/v1/products/trending`                           | Public | Query: `page` (1); 20 per page; in-stock trending products.                                                                                                                                                                                                                                                                           |
| `GET`    | `/v1/products/featured`                           | Public | Query: `page` (1); 20 per page; in-stock featured products.                                                                                                                                                                                                                                                                           |
| `GET`    | `/v1/products/new`                                | Public | Query: `page` (1), `limit` (20); products added in the last 15 days and in stock.                                                                                                                                                                                                                                                     |
| `GET`    | `/v1/products/search`                             | Public | Query: required `q`, optional `page` (1), `limit` (20); searches name and description of in-stock products.                                                                                                                                                                                                                           |
| `GET`    | `/v1/products/:id`                                | Public | Product details, images, category, distributor name, and calculated discount values.                                                                                                                                                                                                                                                  |
| `GET`    | `/v1/products/admin/low-stock`                    | Admin  | Query pagination; finds products with stock from 1 through 20.                                                                                                                                                                                                                                                                        |
| `GET`    | `/v1/products/admin/out-of-stock`                 | Admin  | Query pagination; finds products with zero stock.                                                                                                                                                                                                                                                                                     |
| `POST`   | `/v1/products`                                    | Admin  | Creates a product. JSON fields: required `name`, `description`, `price`, `categoryId`; optional `discountedPrice`, `discountPercent`, `stock`, `tp`, `distributorId` or `distributor`. Alternatively, use multipart form data with the same fields and up to 10 image files in field `images`; uploaded files go to Supabase Storage. |
| `PUT`    | `/v1/products/:id`                                | Admin  | Updates product fields and can append up to 10 `images` multipart files. Product field validator additionally validates distributor and `tp`.                                                                                                                                                                                         |
| `DELETE` | `/v1/products/:id`                                | Admin  | Cannot remove a product referenced by existing order items.                                                                                                                                                                                                                                                                           |
| `PATCH`  | `/v1/products/:id/stock`                          | Admin  | JSON: `stock`, optionally `operation` as `increment` or `decrement`; decrements cannot make stock negative.                                                                                                                                                                                                                           |
| `PATCH`  | `/v1/products/:id/trending`                       | Admin  | JSON: boolean `trending`.                                                                                                                                                                                                                                                                                                             |
| `PATCH`  | `/v1/products/:id/featured`                       | Admin  | JSON: boolean `featured`.                                                                                                                                                                                                                                                                                                             |
| `POST`   | `/v1/products/:id/images`                         | Admin  | Multipart files in field `images`, up to 10; adds images.                                                                                                                                                                                                                                                                             |
| `DELETE` | `/v1/products/:productId/images/:imageId`         | Admin  | Deletes an image from Storage and the database; selects another default image if possible.                                                                                                                                                                                                                                            |
| `PATCH`  | `/v1/products/:productId/images/:imageId/default` | Admin  | Sets the chosen product image as default.                                                                                                                                                                                                                                                                                             |

Product creation's multipart form includes required `name`, `description`, `price`, and `categoryId`; optional `discountedPrice`, `discountPercent`, `stock`, `tp`, distributor fields, and `images` files. JSON product creation does not accept image URL objects through this route. Discount checks reject a discounted price greater than or equal to the regular price and percentages outside 1–100.

### Orders and payments

Mount prefix: `/v1/orders`.

| Method | Path                                  | Access                   | Request/query fields and behavior                                                                                                                                                                                |
| ------ | ------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/orders`                          | Approved user            | JSON: `shippingAddressId`, optional `paymentMethod` (only `cod` is represented in the schema). Creates order from the current cart, checks stock, decrements inventory, clears cart, and creates a notification. |
| `GET`  | `/v1/orders/my-orders`                | Approved user            | Query: `page` (1), `limit` (10), optional `status`. Lists the current user's orders, newest first.                                                                                                               |
| `GET`  | `/v1/orders/my-orders/:orderId`       | Approved user; own order | Gets one order with items, payment, and shipping address.                                                                                                                                                        |
| `PUT`  | `/v1/orders/:orderId/cancel`          | Approved user; own order | Cancels only pending orders and restores stock.                                                                                                                                                                  |
| `GET`  | `/v1/orders`                          | Admin                    | Query: `page` (1), `limit` (20), optional `status`, optional `search` by trailing 8 or more characters of order UUID.                                                                                            |
| `GET`  | `/v1/orders/:orderId`                 | Admin                    | Gets order details with user, items, payment, and shipping address.                                                                                                                                              |
| `PUT`  | `/v1/orders/:orderId/status`          | Admin                    | JSON: `status` in `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`; sends a notification.                                                                                                          |
| `PUT`  | `/v1/orders/:orderId/payment/confirm` | Admin                    | Confirms COD payment and sets `paidAt`; sends a notification.                                                                                                                                                    |

Order statuses are `pending`, `confirmed`, `processing`, `shipped`, `delivered`, and `cancelled`. An order's payment status is initially `pending`; the admin confirmation endpoint changes it to `paid`.

### TSR order access

Mount prefix: `/v1/tsr`. Access requires a JWT with role `TSR`. Orders are scoped to customers whose division, district, and upazila IDs all match the TSR's corresponding profile fields. A TSR without all three location IDs receives empty order results.

| Method  | Path                             | Request/query fields and behavior                                                                                                                            |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/v1/tsr/orders`                 | Query: `page` (1), `limit` (20), optional `status`, `search`, `startDate`, `endDate`. Search checks order ID, customer name, pharmacy name, or phone number. |
| `GET`   | `/v1/tsr/orders/summary`         | Returns order counts grouped by status for the TSR's territory.                                                                                              |
| `GET`   | `/v1/tsr/orders/:orderId`        | Returns an order only if it belongs to the TSR's territory.                                                                                                  |
| `PATCH` | `/v1/tsr/orders/:orderId/status` | JSON: `status` in `confirmed`, `processing`, `shipped`, `delivered`, or `cancelled`; sends a customer notification.                                          |

### Sales and admin TSR reporting

Sales routes require admin role and mount at `/v1/sales`.

| Method | Path                               | Behavior                                                                                                                                         |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/v1/sales/daily`                  | Returns a `daily` summary for pending and confirmed orders across all dates (the current implementation does not restrict this report to today). |
| `GET`  | `/v1/sales/weekly`                 | Seven-day breakdown for shipped and delivered orders.                                                                                            |
| `GET`  | `/v1/sales/monthly`                | Thirty-day breakdown for delivered orders.                                                                                                       |
| `GET`  | `/v1/sales/yearly`                 | Rolling 12-month breakdown for delivered orders.                                                                                                 |
| `GET`  | `/v1/sales/summary`                | Overall sales totals, growth, sales by status, and top products/categories/customers.                                                            |
| `GET`  | `/v1/sales/today-ordered-products` | Despite the route name, the query currently aggregates all confirmed order items and does not filter by date.                                    |

Admin TSR sales routes are mounted at both `/admin/tsr-sales` and `/v1/admin/tsr-sales` (the same handlers and admin authorization apply).

| Method | Path suffix           | Behavior                                                                                                                 |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/allsummary`         | Period summaries for TSRs; optional `tsrId` query filters to one TSR.                                                    |
| `GET`  | `/best-performance`   | Best TSRs by order count and order value for each implemented period.                                                    |
| `GET`  | `/summary`            | Overall order count and order value grouped by status.                                                                   |
| `GET`  | `/tsrs`               | TSR list with territory and order totals.                                                                                |
| `GET`  | `/tsrs/:tsrId`        | TSR territory detail and its latest 20 territory orders.                                                                 |
| `GET`  | `/tsrs/:tsrId/orders` | TSR territory orders. Query: `page` (1), `limit` (20, maximum 100), optional `status`, `search`, `startDate`, `endDate`. |

For the last route, dates must parse as dates and `startDate` must not be after `endDate`. The reporting logic associates territory orders with TSR profiles by matching all three location IDs; multiple TSRs sharing a territory can therefore see/report the same territory's orders.

## Database

PostgreSQL is configured through Prisma. The principal entities and relationships are:

| Model                             | Purpose and relationships                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                            | Customer, administrator, or TSR; unique email and phone; approval flag; optional division/district/upazila; owns a cart, addresses, orders, and notifications.                      |
| `Division`, `District`, `Upazila` | Geographic hierarchy: a division has districts, a district has upazilas; user profiles reference each location level.                                                               |
| `Address`                         | Belongs to a user and can be referenced by orders as their shipping address.                                                                                                        |
| `Category`                        | Has many products; category name is unique.                                                                                                                                         |
| `Distributor`                     | Optional product supplier; distributor name is unique.                                                                                                                              |
| `Product`                         | Belongs to a category and optionally a distributor; includes price, optional discounts and trade price (`tp`), stock, featured/trending flags, images, cart items, and order items. |
| `ProductImage`                    | Product image URL and default-image flag; belongs to a product.                                                                                                                     |
| `Cart`, `CartItem`                | One cart per user; cart items reference products; each cart/product pair is unique.                                                                                                 |
| `Order`, `OrderItem`              | Order belongs to a user and shipping address; includes items and an optional one-to-one payment; order item records product, quantity, and price at order time.                     |
| `Payment`                         | One payment per order; current payment method enum has only `cod`.                                                                                                                  |
| `Notification`                    | User notification with type (`order`, `approval`, `system`) and read state.                                                                                                         |

The schema defines indexes for frequently filtered fields including user role/approval and location IDs, product category/distributor/name/price/stock/discount/featured/trending, and order user/status/creation date. Unique constraints include user email and phone, category/distributor names, cart user, cart/product item pair, and payment order.

Schema changes belong in `prisma/schema.prisma`. Prisma's configured migration path is `prisma/migrations`, but no migration files are checked in. `npm run prisma:migrate` invokes `prisma migrate dev`; use that for development schema changes after setting `DATABASE_URL`. A production migration deployment workflow is not defined in package scripts.

## Caching and Redis

Redis is instantiated from `REDIS_URL`. It is used by:

- Route-level `GET` response caching. TTLs currently include 10 minutes for category lists/details, 5 minutes for product list/details and category product lists, 1 minute for product search and order reads, 30 seconds for TSR/admin-TSR reporting, and 5 minutes for selected sales summaries. User profile/address/cart cache routes use a 1-hour TTL.
- Internal product service caching for trending, featured, and new products with a 5-minute TTL.
- Registration/login rate-limit counters.
- Revoked JWT keys, written for 24 hours on logout.

Route cache keys include the user ID (or `public`), request URL, optional cache version, and optional cache-tag version. Mutations clear selected user caches or advance order/sales cache-tag versions. Product-list caches also use `products:trending:*`, `products:featured:*`, and `products:new` key families.

The server logs Redis connection errors and `connectRedis` reports a ping failure without immediately terminating startup. Some middleware fails open on Redis errors, but authentication, cache operations, and other Redis-dependent handlers can still fail or fall back depending on the call path. A working Redis service should therefore be configured for normal operation.

## Environment variables

No `.env.example` is included. Create a local `.env` file yourself; for Compose, provide the `.env.docker` file referenced by `docker-compose.yml`. Do not commit either file.

| Variable                    | Purpose                                                                |                  Required | Safe example                                        |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------: | --------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection URL for Prisma and Prisma CLI                    |                       Yes | `postgresql://<host>:5432/<database>?schema=public` |
| `REDIS_URL`                 | Redis connection URL used by cache, rate limiting, and token blacklist |  Yes for normal operation | `redis://localhost:6379`                            |
| `JWT_SECRET`                | Secret used to sign and verify application JWTs                        |                       Yes | `<long-random-secret>`                              |
| `SUPABASE_URL`              | Supabase project URL used by Storage client                            | Required for image upload | `https://<project-ref>.supabase.co`                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-side Storage credential                              | Required for image upload | `<server-side-service-role-key>`                    |
| `PORT`                      | HTTP listening port; defaults to `3000`                                |                        No | `3000`                                              |
| `NODE_ENV`                  | Controls Prisma query logging and whether order errors include details |                        No | `development` or `production`                       |

## Prerequisites

- Node.js compatible with the Dockerfile's Node 20 runtime and npm.
- A PostgreSQL database and a Redis instance.
- A Supabase project with a Storage bucket named `medicare-images` if product image uploads are needed.
- Prisma CLI access through the installed npm dependencies.

## Local setup and development

1. Clone the repository and create `.env` in the repository root with at least `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET`. Add the Supabase variables if using image uploads. Set the environment before installing because Prisma Client generation runs in the install lifecycle.

   ```bash
   git clone <repository-url>
   cd medicare-server
   # Create and populate .env before continuing.
   npm ci
   ```

2. Generate the Prisma client and apply/create the development database migration:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

   `prisma:migrate` runs `prisma migrate dev`; the project does not include a checked-in migration history or seed script.

3. Start the development server:

   ```bash
   npm run dev
   ```

   `nodemon` executes `ts-node src/index.ts` and watches `src`.

4. Verify the HTTP server:

   ```bash
   curl http://localhost:3000/
   ```

   Expected response: `{"status":"OK","message":"Server is running"}`.

### Build and run

```bash
npm run build
npm start
```

The build runs `prisma generate` and TypeScript compilation into `dist`; `start` runs `node dist/index.js`. Ensure required environment variables are available to the process.

Useful Prisma commands:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Docker

The Compose file starts the API on port `3000` and Redis on port `6379`; it waits for Redis's health check before starting the app. It expects an `.env.docker` file at the repository root, which is not provided. Create it locally with the required values, including a Docker-network Redis URL such as `redis://redis:6379` and an externally reachable PostgreSQL `DATABASE_URL`, then run:

```bash
docker compose up --build
```

The Dockerfile builds the TypeScript output and runs the production image on port `3000`. It does not run database migrations automatically. The Compose setup uses a named Redis data volume but does not define a database container; provision PostgreSQL separately.

## Errors and logging

Controllers commonly log caught errors with `console.error` and return JSON. Validation errors from `express-validator` use `{ "errors": [...] }`; many controllers use `{ "success": false, "error": "..." }`; auth/account handlers may use `{ "error": "..." }`. Status codes used include `400` for invalid requests, `401` for missing authentication, `403` for invalid tokens or insufficient permissions, `404` for missing records, `409` for selected conflicts, and `500` for server errors.

The final Express error middleware logs the stack and returns `{ "error": "Something went wrong!" }` with status `500`. There is no request logger or centralized typed error system. Prisma query, warning, and error logs are enabled in development; production Prisma logging includes errors only.

## Testing

No test files, test runner, or test script are configured in the checked-in project. `npm test` is therefore not an available project command.

## Deployment notes

The repository supports a Docker image and Compose configuration, but does not identify a hosting provider or include CI/CD workflows, health-check configuration beyond Compose's Redis check, or an automated database migration step. For a production deployment:

1. Build using `npm run build` or the provided Dockerfile.
2. Supply all production secrets via the deployment platform's secret/environment configuration.
3. Provide reachable PostgreSQL and Redis services.
4. Provision the Supabase `medicare-images` bucket and service key if uploads are needed.
5. Apply database migrations through an explicitly managed deployment process; the repository currently documents only `prisma migrate dev`, and no migration files are checked in.
6. Expose the configured `PORT` and monitor application/database/Redis logs.

Configure CORS origins, proxy/IP handling for rate limiting, and secret rotation according to the target environment; the application itself currently uses Express's default CORS configuration.

## Troubleshooting

- **Prisma cannot connect:** Check `DATABASE_URL`, network access, and that PostgreSQL is accepting connections. Prisma connection failures are logged when the client connects.
- **Redis host errors:** Check `REDIS_URL`. In Docker Compose, use the service hostname `redis`, not `localhost`.
- **Compose reports a missing env file:** Create `.env.docker` locally; it is referenced by Compose but is intentionally not present in the repository.
- **Image uploads fail:** Check `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket name `medicare-images`, file type, and the 5 MiB per-file limit.
- **Login is denied after registering:** An administrator must first approve the account.
- **TSR order lists are empty:** The TSR must have matching division, district, and upazila IDs assigned; all three are required for territory scoping.

## Contributing

Keep API behavior and this documentation aligned. For changes to database models, update the Prisma schema and create migrations as appropriate. No project-specific contribution or code-formatting policy is currently included.

## License

No license file or license declaration was found in the repository. Confirm the project's licensing terms with its maintainers before redistribution.
